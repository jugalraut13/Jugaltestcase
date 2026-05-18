import { useState, useEffect } from 'react';
import './App.css';

const BACKEND_URL = 'http://localhost:5000';

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    icon: '🤖',
    requiresKey: true,
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    icon: '✨',
    requiresKey: true,
    models: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    defaultModel: 'gemini-1.5-flash'
  },
  {
    id: 'groq',
    name: 'Groq (Llama 3)',
    icon: '⚡',
    requiresKey: true,
    models: ['llama3-8b-8192', 'llama3-70b-8192', 'mixtral-8x7b-32768'],
    defaultModel: 'llama3-8b-8192'
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    icon: '🖥️',
    requiresKey: false,
    models: ['phi3:latest', 'mistral:latest', 'llama3:latest', 'phi3', 'mistral', 'llama3'],
    defaultModel: 'phi3:latest'
  }
];

function App() {
  // Jira Input State
  const [ticketId, setTicketId] = useState('');
  const [jiraData, setJiraData] = useState(null);
  const [editableContent, setEditableContent] = useState('');
  
  // App & Model Settings State
  const [selectedModel, setSelectedModel] = useState('openai');
  const [modelName, setModelName] = useState('gpt-4');
  
  // API Keys & Config
  const [apiKeys, setApiKeys] = useState({
    openai: '',
    gemini: '',
    groq: ''
  });
  
  const [jiraConfig, setJiraConfig] = useState({
    domain: '',
    email: '',
    token: '',
    bugIssueType: 'Bug'
  });

  // UI Status State
  const [showSettings, setShowSettings] = useState(false);
  const [fetchingJira, setFetchingJira] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedTestCases, setGeneratedTestCases] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Defect Form States
  const [defectSummary, setDefectSummary] = useState('');
  const [defectDescription, setDefectDescription] = useState('');
  const [defectSteps, setDefectSteps] = useState('');
  const [defectExpected, setDefectExpected] = useState('');
  const [defectActual, setDefectActual] = useState('');
  const [defectSeverity, setDefectSeverity] = useState('Medium');
  const [defectPriority, setDefectPriority] = useState('Medium');
  const [defectProjectKey, setDefectProjectKey] = useState('QA');
  const [generatingDefect, setGeneratingDefect] = useState(false);
  const [creatingDefect, setCreatingDefect] = useState(false);
  const [defectSuccessMsg, setDefectSuccessMsg] = useState('');

  // Load configuration from LocalStorage
  useEffect(() => {
    const savedKeys = localStorage.getItem('qa_api_keys');
    const savedJira = localStorage.getItem('qa_jira_config');
    const savedProvider = localStorage.getItem('qa_selected_provider');
    const savedModelName = localStorage.getItem('qa_selected_model_name');

    if (savedKeys) setApiKeys(JSON.parse(savedKeys));
    if (savedJira) setJiraConfig(JSON.parse(savedJira));
    if (savedProvider) setSelectedModel(savedProvider);
    if (savedModelName) setModelName(savedModelName);
  }, []);

  // Update default model on provider dropdown change
  const handleProviderChange = (e) => {
    const providerId = e.target.value;
    setSelectedModel(providerId);
    setErrorMsg(''); // Reset error banner on model change
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (provider) {
      setModelName(provider.defaultModel);
      localStorage.setItem('qa_selected_model_name', provider.defaultModel);
    }
    localStorage.setItem('qa_selected_provider', providerId);
  };

  // Save Settings to LocalStorage
  const handleSaveSettings = () => {
    localStorage.setItem('qa_api_keys', JSON.stringify(apiKeys));
    localStorage.setItem('qa_jira_config', JSON.stringify(jiraConfig));
    localStorage.setItem('qa_selected_provider', selectedModel);
    localStorage.setItem('qa_selected_model_name', modelName);

    setSettingsSaved(true);
    setTimeout(() => {
      setSettingsSaved(false);
      setShowSettings(false);
    }, 1000);
  };

  // Fetch Jira Ticket details
  const fetchJiraTicket = async () => {
    if (!ticketId.trim()) {
      setErrorMsg('Please enter a valid Jira Ticket ID.');
      return;
    }
    setErrorMsg('');
    setFetchingJira(true);
    setJiraData(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/jira/${ticketId.trim()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-jira-domain': jiraConfig.domain || '',
          'x-jira-email': jiraConfig.email || '',
          'x-jira-token': jiraConfig.token || ''
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch Jira ticket.');
      }

      setJiraData(data);
      
      // Compile summary, description, acceptance criteria into an editable unified content box
      const combined = `Jira ID: ${data.ticketId}\nSummary: ${data.title}\n\nDescription:\n${data.description || 'N/A'}\n\nAcceptance Criteria:\n${data.acceptanceCriteria || 'N/A'}`;
      setEditableContent(combined);

    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setFetchingJira(false);
    }
  };

  // Generate QA Test Cases using AI
  const generateTestCases = async () => {
    if (!editableContent.trim()) {
      setErrorMsg('Jira story details are empty. Import a Jira ticket or enter user story manually.');
      return;
    }
    setErrorMsg('');
    setGenerating(true);
    setGeneratedTestCases('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jiraContent: editableContent,
          selectedModel,
          modelName,
          apiKeys
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Test case generation failed.');
      }

      setGeneratedTestCases(data.testCases);

    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setGenerating(false);
    }
  };

  // Copy test cases to clipboard
  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedTestCases);
    alert('Test cases copied to clipboard!');
  };

  // Automatically generate defect details using selected AI model
  const generateDefectUsingAI = async () => {
    const context = editableContent || generatedTestCases;
    if (!context.trim()) {
      setErrorMsg('No story details or test cases found to generate defect details from.');
      return;
    }
    setErrorMsg('');
    setGeneratingDefect(true);
    setDefectSuccessMsg('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/generate-defect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueContext: context,
          selectedModel,
          modelName,
          apiKeys
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate defect details.');
      }

      setDefectSummary(data.summary || '');
      setDefectDescription(data.description || '');
      setDefectSteps(data.steps || '');
      setDefectExpected(data.expectedResult || '');
      setDefectActual(data.actualResult || '');

    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setGeneratingDefect(false);
    }
  };

  // Submit Bug ticket to Jira Cloud REST API
  const submitDefectToJira = async () => {
    if (!defectSummary.trim()) {
      setErrorMsg('Defect Summary (Title) is required.');
      return;
    }
    setErrorMsg('');
    setCreatingDefect(true);
    setDefectSuccessMsg('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/jira/defect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jira-domain': jiraConfig.domain || '',
          'x-jira-email': jiraConfig.email || '',
          'x-jira-token': jiraConfig.token || ''
        },
        body: JSON.stringify({
          summary: defectSummary,
          description: defectDescription,
          steps: defectSteps,
          expectedResult: defectExpected,
          actualResult: defectActual,
          severity: defectSeverity,
          priority: defectPriority,
          projectKey: defectProjectKey,
          bugIssueType: jiraConfig.bugIssueType || 'Bug'
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit defect ticket to Jira.');
      }

      setDefectSuccessMsg(`Defect created successfully! Ticket ID: ${data.ticketId}`);
      // Clear form fields on success
      setDefectSummary('');
      setDefectDescription('');
      setDefectSteps('');
      setDefectExpected('');
      setDefectActual('');

    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setCreatingDefect(false);
    }
  };

  return (
    <div className="app-wrapper">
      <div className="dashboard-container">
        
        {/* Header Section */}
        <header>
          <div className="header-brand">
            <span className="brand-logo">📋</span>
            <h1>Jira Test Case Generator</h1>
          </div>
          <div className="header-controls">
            <div className="model-selector-group">
              <label htmlFor="top-model-select">Active Model:</label>
              <select 
                id="top-model-select"
                value={selectedModel} 
                onChange={handleProviderChange}
              >
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                ))}
              </select>
            </div>
            
            <button 
              className="icon-btn" 
              onClick={() => setShowSettings(true)}
              title="Settings"
              id="settings-trigger"
            >
              ⚙️
            </button>
          </div>
        </header>

        {/* Global Error Banner */}
        {errorMsg && (
          <div className="error-banner" id="error-banner">
            <span>⚠️ <strong>Error:</strong> {errorMsg}</span>
            <button className="close-banner" onClick={() => setErrorMsg('')}>✕</button>
          </div>
        )}

        {/* Main Workspace split panel */}
        <main className="workspace-grid">
          
          {/* Left Column - Jira Input & Edit Story */}
          <section className="card workspace-left">
            <div className="card-header">
              <h2>1. Import Jira User Story</h2>
            </div>
            
            <div className="jira-import-bar">
              <input 
                type="text" 
                placeholder="Enter Jira Ticket ID (e.g. PROJ-123)"
                value={ticketId}
                onChange={e => setTicketId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchJiraTicket()}
                id="jira-ticket-input"
              />
              <button 
                className="btn btn-primary" 
                onClick={fetchJiraTicket}
                disabled={fetchingJira}
                id="jira-fetch-btn"
              >
                {fetchingJira ? 'Fetching...' : 'Fetch Story'}
              </button>
            </div>

            {jiraData && (
              <div className="imported-preview" id="imported-preview">
                <div className="preview-field">
                  <span className="field-title">Title</span>
                  <div className="field-value">{jiraData.title}</div>
                </div>
                <div className="preview-split">
                  <div className="preview-field">
                    <span className="field-title">Description Preview</span>
                    <div className="field-value description-box">{jiraData.description || 'No description found.'}</div>
                  </div>
                  <div className="preview-field">
                    <span className="field-title">Acceptance Criteria</span>
                    <div className="field-value ac-box">{jiraData.acceptanceCriteria || 'No acceptance criteria found.'}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="editor-section">
              <div className="editor-header">
                <h3>Editable Story Context</h3>
                <span className="hint">Refine the imported details before generating test cases</span>
              </div>
              <textarea 
                value={editableContent}
                onChange={e => setEditableContent(e.target.value)}
                placeholder="User story context will populate here after fetch, or you can paste your story manually..."
                id="jira-content-editor"
              />
            </div>
          </section>

          {/* Right Column - Test Case Output */}
          <section className="card workspace-right">
            <div className="card-header split-header">
              <h2>2. Generated Test Cases</h2>
              {generatedTestCases && (
                <button 
                  className="btn btn-secondary btn-sm" 
                  onClick={copyToClipboard}
                  id="copy-btn"
                >
                  📋 Copy Cases
                </button>
              )}
            </div>

            <div className="action-control-bar">
              <div className="model-detail-row">
                <span className="model-label">Model Engine:</span>
                <select
                  value={modelName}
                  onChange={e => {
                    setModelName(e.target.value);
                    localStorage.setItem('qa_selected_model_name', e.target.value);
                  }}
                  id="sub-model-select"
                >
                  {PROVIDERS.find(p => p.id === selectedModel)?.models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <button 
                className="btn btn-primary generate-btn" 
                onClick={generateTestCases}
                disabled={generating || !editableContent}
                id="generate-btn"
              >
                {generating ? (
                  <>
                    <span className="spinner">⏳</span> Generating Test Cases...
                  </>
                ) : (
                  '⚡ Generate Test Cases'
                )}
              </button>
            </div>

            <div className="output-container" id="output-container">
              {generatedTestCases ? (
                <pre className="markdown-output">{generatedTestCases}</pre>
              ) : (
                <div className="empty-output">
                  <div className="empty-icon">🧪</div>
                  <h3>Ready for Test Cases</h3>
                  <p>Your structured functional, negative, and boundary test cases will appear here.</p>
                </div>
              )}
            </div>
          </section>
        </main>

        {/* Create Defect section */}
        <section className="card defect-creation-section">
          <div className="card-header defect-header">
            <div className="header-left">
              <h2>3. Create Defect in Jira</h2>
              <span className="subtitle-hint">Log bugs directly into Jira Cloud using manual inputs or AI generation</span>
            </div>
            <button 
              className="btn btn-secondary ai-sparkle-btn" 
              onClick={generateDefectUsingAI}
              disabled={generatingDefect || (!editableContent && !generatedTestCases)}
              id="ai-generate-defect-btn"
            >
              {generatingDefect ? (
                <>⏳ Analyzing details...</>
              ) : (
                <>✨ Generate Defect details using AI</>
              )}
            </button>
          </div>

          {defectSuccessMsg && (
            <div className="success-banner" id="defect-success-banner">
              <span>🎉 <strong>Success:</strong> {defectSuccessMsg}</span>
              <button className="close-banner" onClick={() => setDefectSuccessMsg('')}>✕</button>
            </div>
          )}

          <div className="defect-form-grid">
            <div className="form-group-col">
              <div className="form-row-split">
                <div className="form-group flex-summary">
                  <label htmlFor="defect-summary">Defect Summary (Title) *</label>
                  <input 
                    type="text" 
                    id="defect-summary"
                    placeholder="Brief summary of the found defect"
                    value={defectSummary}
                    onChange={e => setDefectSummary(e.target.value)}
                  />
                </div>
                <div className="form-group sm-key">
                  <label htmlFor="defect-project">Project Key</label>
                  <input 
                    type="text" 
                    id="defect-project"
                    placeholder="e.g. QA"
                    value={defectProjectKey}
                    onChange={e => setDefectProjectKey(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="defect-description">Defect Context / Description</label>
                <textarea 
                  id="defect-description"
                  placeholder="Provide additional defect context or environment settings"
                  value={defectDescription}
                  onChange={e => setDefectDescription(e.target.value)}
                  rows="2"
                />
              </div>

              <div className="form-group">
                <label htmlFor="defect-steps">Steps to Reproduce</label>
                <textarea 
                  id="defect-steps"
                  placeholder="1. Navigate to...\n2. Click on..."
                  value={defectSteps}
                  onChange={e => setDefectSteps(e.target.value)}
                  rows="3"
                />
              </div>
            </div>

            <div className="form-group-col">
              <div className="form-group">
                <label htmlFor="defect-expected">Expected Result</label>
                <textarea 
                  id="defect-expected"
                  placeholder="What the system should do"
                  value={defectExpected}
                  onChange={e => setDefectExpected(e.target.value)}
                  rows="2"
                />
              </div>

              <div className="form-group">
                <label htmlFor="defect-actual">Actual Result</label>
                <textarea 
                  id="defect-actual"
                  placeholder="What the system actually did"
                  value={defectActual}
                  onChange={e => setDefectActual(e.target.value)}
                  rows="2"
                />
              </div>

              <div className="form-row-split dropdowns">
                <div className="form-group">
                  <label htmlFor="defect-severity">Severity</label>
                  <select 
                    id="defect-severity"
                    value={defectSeverity}
                    onChange={e => setDefectSeverity(e.target.value)}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="defect-priority">Priority</label>
                  <select 
                    id="defect-priority"
                    value={defectPriority}
                    onChange={e => setDefectPriority(e.target.value)}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              <div className="defect-action-row">
                <button 
                  className="btn btn-primary create-defect-submit-btn" 
                  onClick={submitDefectToJira}
                  disabled={creatingDefect || !defectSummary}
                  id="create-defect-submit-btn"
                >
                  {creatingDefect ? (
                    <>⏳ Logging bug to Jira Cloud...</>
                  ) : (
                    <>🐞 Create Defect in Jira</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Configuration Modal */}
        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} id="settings-panel">
              
              <div className="modal-header">
                <h2>⚙️ Configuration & API Settings</h2>
                <button className="close-btn" onClick={() => setShowSettings(false)}>✕</button>
              </div>

              <div className="settings-scroll-box">
                {/* 1. Jira Server Settings */}
                <fieldset className="settings-section">
                  <legend>Jira Cloud Server Settings</legend>
                  <div className="form-group">
                    <label>Jira Domain Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. my-company.atlassian.net"
                      value={jiraConfig.domain}
                      onChange={e => setJiraConfig({ ...jiraConfig, domain: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>User Email Address</label>
                    <input 
                      type="email" 
                      placeholder="email@company.com"
                      value={jiraConfig.email}
                      onChange={e => setJiraConfig({ ...jiraConfig, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Atlassian API Token</label>
                    <input 
                      type="password" 
                      placeholder="Enter Atlassian API Token"
                      value={jiraConfig.token}
                      onChange={e => setJiraConfig({ ...jiraConfig, token: e.target.value })}
                    />
                    <span className="hint-text">Create token at id.atlassian.com/manage-profile/security/api-tokens</span>
                  </div>
                  <div className="form-group">
                    <label>Bug Issue Type Name or ID (Optional)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Bug, Defect, or ID (e.g. 10004)"
                      value={jiraConfig.bugIssueType}
                      onChange={e => setJiraConfig({ ...jiraConfig, bugIssueType: e.target.value })}
                    />
                    <span className="hint-text">If your Jira project doesn't use 'Bug' (e.g. uses ID '10004'), enter it here.</span>
                  </div>
                </fieldset>

                {/* 2. Model API Key Settings */}
                <fieldset className="settings-section">
                  <legend>AI Model Integration API Keys</legend>
                  <div className="form-group">
                    <label>OpenAI API Key</label>
                    <input 
                      type="password" 
                      placeholder="sk-..."
                      value={apiKeys.openai}
                      onChange={e => setApiKeys({ ...apiKeys, openai: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Google Gemini API Key</label>
                    <input 
                      type="password" 
                      placeholder="AIzaSy..."
                      value={apiKeys.gemini}
                      onChange={e => setApiKeys({ ...apiKeys, gemini: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Groq API Key</label>
                    <input 
                      type="password" 
                      placeholder="gsk_..."
                      value={apiKeys.groq}
                      onChange={e => setApiKeys({ ...apiKeys, groq: e.target.value })}
                    />
                  </div>
                </fieldset>
              </div>

              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
                <button 
                  className={`btn btn-primary ${settingsSaved ? 'saved' : ''}`}
                  onClick={handleSaveSettings}
                  id="save-settings-btn"
                >
                  {settingsSaved ? '✓ Config Saved' : 'Save Config'}
                </button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
