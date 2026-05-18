process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// QA System Prompt for Test Case Generation
const QA_SYSTEM_PROMPT = `Act as QA Engineer. Generate test cases from below Jira story.
Include functional, negative, and boundary cases.
Keep output clear and structured.`;

// Helper to recursively parse Jira Atlassian Document Format (ADF) to plain text
function parseADF(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(parseADF).join('\n');
  }
  return '';
}

// Helper to extract acceptance criteria from Jira custom fields or text
function extractAcceptanceCriteria(issue) {
  const fields = issue.fields || {};
  // Try custom fields or search in descriptions
  for (const key in fields) {
    if (key.startsWith('customfield_') && fields[key]) {
      const val = fields[key];
      if (typeof val === 'string' && (val.toLowerCase().includes('scenario') || val.toLowerCase().includes('acceptance'))) {
        return val;
      }
      if (typeof val === 'object' && val.type === 'doc') {
        const text = parseADF(val);
        if (text.toLowerCase().includes('acceptance') || text.toLowerCase().includes('given') || text.toLowerCase().includes('then')) {
          return text;
        }
      }
    }
  }
  return '';
}

// ── GET /api/jira/:ticketId ──────────────────────────────────────────
app.get('/api/jira/:ticketId', async (req, res) => {
  const { ticketId } = req.params;
  const jiraDomain = req.headers['x-jira-domain'];
  const jiraEmail = req.headers['x-jira-email'];
  const jiraToken = req.headers['x-jira-token'];

  if (!jiraDomain || !jiraEmail || !jiraToken) {
    return res.status(400).json({
      error: 'Jira configuration (Domain, Email, API Token) is missing. Set them in Settings (⚙️).'
    });
  }

  try {
    const domainClean = jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${domainClean}/rest/api/3/issue/${ticketId}`;
    
    const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    const issue = response.data;
    const summary = issue.fields?.summary || '';
    
    // Parse description (usually ADF JSON in API v3)
    let description = '';
    const descField = issue.fields?.description;
    if (descField) {
      if (typeof descField === 'object' && descField.type === 'doc') {
        description = parseADF(descField);
      } else {
        description = String(descField);
      }
    }

    // Try to extract acceptance criteria
    let acceptanceCriteria = extractAcceptanceCriteria(issue);
    
    // If not found separately, check if description contains "Acceptance Criteria" block
    if (!acceptanceCriteria && description) {
      const match = description.match(/(?:Acceptance Criteria|AC\b)[\s\S]+/i);
      if (match) {
        acceptanceCriteria = match[0];
      }
    }

    res.json({
      ticketId,
      title: summary,
      description: description.trim(),
      acceptanceCriteria: acceptanceCriteria.trim()
    });

  } catch (error) {
    console.error('[Jira Fetch Error]:', error.message);
    let errMsg = 'Failed to fetch Jira ticket.';
    if (error.response) {
      if (error.response.status === 401 || error.response.status === 403) {
        errMsg = 'Invalid Jira Credentials. Please check your Email and API Token in Settings.';
      } else if (error.response.status === 404) {
        errMsg = `Jira ticket "${ticketId}" not found. Verify the Ticket ID.`;
      } else {
        errMsg = error.response.data?.errorMessages?.[0] || error.message;
      }
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      errMsg = 'Invalid Jira Domain name. Check your Jira Domain settings.';
    }
    res.status(500).json({ error: errMsg });
  }
});

// ── POST /api/generate ──────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { jiraContent, selectedModel, apiKeys, modelName } = req.body;

  if (!jiraContent || !jiraContent.trim()) {
    return res.status(400).json({ error: 'Jira content / story details are required to generate test cases.' });
  }

  const keys = apiKeys || {};
  const activeModel = selectedModel || 'ollama';

  try {
    let resultText = '';
    const fullPrompt = `${QA_SYSTEM_PROMPT}\n\nJira Story / Details:\n${jiraContent}`;

    // 1. OpenAI Integration
    if (activeModel === 'openai') {
      const apiKey = keys.openai;
      if (!apiKey) return res.status(400).json({ error: 'OpenAI API Key is missing. Update in Settings.' });

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: modelName || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.7
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 45000
      });
      resultText = response.data.choices[0].message.content;

    // 2. Google Gemini Integration
    } else if (activeModel === 'gemini') {
      const apiKey = keys.gemini;
      if (!apiKey) return res.status(400).json({ error: 'Gemini API Key is missing. Update in Settings.' });

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: fullPrompt }] }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 45000
        }
      );
      resultText = response.data.candidates[0].content.parts[0].text;

    // 3. Groq Integration
    } else if (activeModel === 'groq') {
      const apiKey = keys.groq;
      if (!apiKey) return res.status(400).json({ error: 'Groq API Key is missing. Update in Settings.' });

      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: modelName || 'llama3-8b-8192',
        messages: [{ role: 'user', content: fullPrompt }]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 45000
      });
      resultText = response.data.choices[0].message.content;

    // 4. Ollama (Local) Integration
    } else if (activeModel === 'ollama') {
      let localModel = modelName || 'phi3';
      // Automatically append :latest if it is one of the standard models without tags
      if (['phi3', 'mistral', 'llama3'].includes(localModel)) {
        localModel = `${localModel}:latest`;
      }
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: localModel,
        prompt: fullPrompt,
        stream: false
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 300000 // 5 minutes for local models to fully complete generation
      });
      resultText = response.data.response;

    } else {
      return res.status(400).json({ error: `Unsupported model provider: ${activeModel}` });
    }

    res.json({ testCases: resultText });

  } catch (error) {
    console.error('[AI Generation Error]:', error.message);
    let errMsg = 'AI generation failed.';
    
    if (error.code === 'ECONNREFUSED') {
      if (activeModel === 'ollama') {
        errMsg = 'Failed to connect to local Ollama. Make sure Ollama app is running locally.';
      } else {
        errMsg = 'Network request failed. Check your internet connection.';
      }
    } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
      if (activeModel === 'ollama') {
        errMsg = 'Ollama local generation timed out. Since it runs locally, the first time you run a model it might take a couple of minutes to load into memory. Please try clicking Generate again!';
      } else {
        errMsg = `${activeModel.toUpperCase()} API request timed out. Please try again.`;
      }
    } else if (error.response) {
      const status = error.response.status;
      if (status === 401) {
        errMsg = `Invalid API Key for ${activeModel.toUpperCase()}. Please check your settings.`;
      } else {
        errMsg = error.response.data?.error?.message || error.message;
      }
    } else {
      errMsg = error.message || errMsg;
    }
    res.status(500).json({ error: errMsg });
  }
});

// ── POST /api/generate-defect ──────────────────────────────────────
app.post('/api/generate-defect', async (req, res) => {
  const { issueContext, selectedModel, apiKeys, modelName } = req.body;

  if (!issueContext || !issueContext.trim()) {
    return res.status(400).json({ error: 'Issue context is required to generate a defect report.' });
  }

  const keys = apiKeys || {};
  const activeModel = selectedModel || 'ollama';

  const DEFECT_SYSTEM_PROMPT = `Act as QA Engineer. Create a bug report from below issue details or test cases.
Format your response as a valid JSON object ONLY. Do not return any other text, explanations, or code blocks.
The JSON object must have exactly these keys:
{
  "summary": "Short, clear defect summary",
  "description": "Comprehensive explanation of the defect context",
  "steps": "1. Step one\\n2. Step two\\n3. Step three",
  "expectedResult": "What should have happened",
  "actualResult": "What actually happened"
}`;

  try {
    let resultText = '';
    const fullPrompt = `${DEFECT_SYSTEM_PROMPT}\n\nContext:\n${issueContext}`;

    if (activeModel === 'openai') {
      const apiKey = keys.openai;
      if (!apiKey) return res.status(400).json({ error: 'OpenAI API Key is missing. Update in Settings.' });

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: modelName || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.2
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 45000
      });
      resultText = response.data.choices[0].message.content;

    } else if (activeModel === 'gemini') {
      const apiKey = keys.gemini;
      if (!apiKey) return res.status(400).json({ error: 'Gemini API Key is missing. Update in Settings.' });

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: fullPrompt }] }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 45000
        }
      );
      resultText = response.data.candidates[0].content.parts[0].text;

    } else if (activeModel === 'groq') {
      const apiKey = keys.groq;
      if (!apiKey) return res.status(400).json({ error: 'Groq API Key is missing. Update in Settings.' });

      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: modelName || 'llama3-8b-8192',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.2
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 45000
      });
      resultText = response.data.choices[0].message.content;

    } else if (activeModel === 'ollama') {
      let localModel = modelName || 'phi3';
      if (['phi3', 'mistral', 'llama3'].includes(localModel)) {
        localModel = `${localModel}:latest`;
      }

      const response = await axios.post('http://localhost:11434/api/generate', {
        model: localModel,
        prompt: fullPrompt,
        stream: false
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 300000
      });
      resultText = response.data.response;

    } else {
      return res.status(400).json({ error: `Unsupported model provider: ${activeModel}` });
    }

    // Try parsing JSON out of AI response
    let defectData = {};
    try {
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      const cleanString = jsonMatch ? jsonMatch[0] : resultText;
      defectData = JSON.parse(cleanString.trim());
    } catch (e) {
      console.warn('[AI JSON Parse Failure]:', resultText);
      // Fallback: Populate plain text in summary, and the rest in description
      defectData = {
        summary: 'AI Generated Defect Report',
        description: resultText,
        steps: 'See description',
        expectedResult: 'See description',
        actualResult: 'See description'
      };
    }

    res.json(defectData);

  } catch (error) {
    console.error('[AI Defect Generation Error]:', error.message);
    res.status(500).json({ error: error.message || 'Failed to generate defect report using AI.' });
  }
});

// ── POST /api/jira/defect ───────────────────────────────────────────
app.post('/api/jira/defect', async (req, res) => {
  const { 
    summary, 
    description, 
    steps, 
    expectedResult, 
    actualResult, 
    severity, 
    priority,
    projectKey,
    bugIssueType
  } = req.body;

  const jiraDomain = req.headers['x-jira-domain'];
  const jiraEmail = req.headers['x-jira-email'];
  const jiraToken = req.headers['x-jira-token'];

  if (!jiraDomain || !jiraEmail || !jiraToken) {
    return res.status(400).json({
      error: 'Jira configuration (Domain, Email, API Token) is missing. Set them in Settings (⚙️).'
    });
  }

  if (!summary || !summary.trim()) {
    return res.status(400).json({ error: 'Defect Summary is required.' });
  }

  const cleanProjectKey = (projectKey || 'PROJ').toUpperCase().trim();

  // Combine fields into full description
  const combinedDescription = `Steps to Reproduce:
${steps || 'N/A'}

Expected Result:
${expectedResult || 'N/A'}

Actual Result:
${actualResult || 'N/A'}

Description Details:
${description || 'N/A'}

Severity: ${severity || 'Medium'}`;

  // Atlassian Document Format (ADF) required for Jira API v3
  const descriptionADF = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: combinedDescription
          }
        ]
      }
    ]
  };

  try {
    const domainClean = jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

    // ── AUTO-RESOLVE CORRECT ISSUE TYPE FROM JIRA ──────────────────────
    let finalIssueTypeObj = null;
    const userTypeClean = (bugIssueType || 'Bug').trim();

    try {
      console.log(`[Jira Metadata]: Fetching issue types for project ${cleanProjectKey}...`);
      const metaUrl = `https://${domainClean}/rest/api/3/issue/createmeta/${cleanProjectKey}/issuetypes`;
      const metaRes = await axios.get(metaUrl, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      console.log(`[Jira Metadata Response]:`, JSON.stringify(metaRes.data));
      const issueTypesList = metaRes.data?.issueTypes || metaRes.data?.values || metaRes.data || [];
      let issueTypesListToUse = [];
      if (Array.isArray(issueTypesList)) {
        issueTypesListToUse = issueTypesList;
      } else if (issueTypesList.issueTypes) {
        issueTypesListToUse = issueTypesList.issueTypes;
      } else if (issueTypesList.values) {
        issueTypesListToUse = issueTypesList.values;
      }
      
      if (issueTypesListToUse.length > 0) {
        // 1. Exact match (case-insensitive) on name or id with user input
        let match = issueTypesListToUse.find(t => 
          t.name?.toLowerCase() === userTypeClean.toLowerCase() || t.id === userTypeClean
        );

        // 2. Contains "bug" or "defect" case-insensitive
        if (!match) {
          match = issueTypesListToUse.find(t => 
            t.name?.toLowerCase().includes('bug') || t.name?.toLowerCase().includes('defect')
          );
        }

        // 3. Contains "task", "story", or "incident"
        if (!match) {
          match = issueTypesListToUse.find(t => 
            !t.subtask && (t.name?.toLowerCase().includes('task') || t.name?.toLowerCase().includes('story') || t.name?.toLowerCase().includes('incident'))
          );
        }

        // 4. First non-subtask issue type available
        if (!match) {
          match = issueTypesListToUse.find(t => !t.subtask);
        }

        if (match) {
          finalIssueTypeObj = { id: match.id };
          console.log(`[Auto-Resolved Issue Type for ${cleanProjectKey}]: "${match.name}" (ID: ${match.id})`);
        }
      }
    } catch (metaErr) {
      console.warn(`[Jira Metadata Warn]: Failed to fetch issuetypes for project key ${cleanProjectKey}:`, metaErr.message);
    }

    // Fallback if metadata resolution is empty/failed
    if (!finalIssueTypeObj) {
      const isNumericId = /^\d+$/.test(userTypeClean);
      finalIssueTypeObj = isNumericId ? { id: userTypeClean } : { name: userTypeClean };
    }

    const url = `https://${domainClean}/rest/api/3/issue`;
    const jiraBody = {
      fields: {
        project: {
          key: cleanProjectKey
        },
        summary: summary.trim(),
        description: descriptionADF,
        issuetype: finalIssueTypeObj,
        priority: {
          name: priority || 'Medium'
        }
      }
    };

    const response = await axios.post(url, jiraBody, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 20000
    });

    res.json({
      success: true,
      ticketId: response.data.key,
      id: response.data.id,
      self: response.data.self
    });

  } catch (error) {
    console.error('[Jira Defect Creation Error]:', error.message);
    let errMsg = 'Failed to create defect in Jira.';
    if (error.response) {
      if (error.response.status === 400) {
        errMsg = error.response.data?.errors || error.response.data || error.message;
        if (typeof errMsg === 'object') {
          errMsg = Object.entries(errMsg).map(([k, v]) => `${k}: ${v}`).join(', ');
        }
      } else if (error.response.status === 401 || error.response.status === 403) {
        errMsg = 'Invalid Jira Credentials. Verify your API Token in Settings.';
      } else {
        errMsg = error.response.data?.errorMessages?.[0] || error.message;
      }
    }
    res.status(500).json({ error: errMsg });
  }
});

// Root check
app.get('/', (req, res) => {
  res.send('Jira QA Test Case Generator Backend is running!');
});

app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));
