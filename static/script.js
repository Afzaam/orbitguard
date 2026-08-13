/*
  OrbitGuard – Frontend JavaScript
  
  Handles:
  - Form submission for telemetry input
  - AJAX request to the Flask backend
  - Display of triage results
  - UI state management (loading, errors, etc.)
*/

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const triageForm = document.getElementById('triageForm');
const telemetryInput = document.getElementById('telemetryInput');
const runButton = document.getElementById('runButton');
const clearButton = document.getElementById('clearButton');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorAlert = document.getElementById('errorAlert');
const errorMessage = document.getElementById('errorMessage');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Handle form submission (Run Triage button)
triageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runTriage();
});

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Send telemetry data to the backend for triage analysis
 */
async function runTriage() {
    // Get telemetry text from textarea
    const telemetryText = telemetryInput.value.trim();

    // Validate input
    if (!telemetryText) {
        showError('Please paste telemetry data before running triage.');
        return;
    }

    // Clear previous results and errors
    hideError();
    resultsSection.classList.add('hidden');
    resultsList.innerHTML = '';

    // Show loading indicator
    loadingIndicator.classList.remove('hidden');
    runButton.disabled = true;

    try {
        // Send POST request to the Flask backend
        const response = await fetch('/api/triage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                telemetry: telemetryText,
            }),
        });

        // Check for HTTP errors
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to run triage');
        }

        // Parse the response
        const data = await response.json();

        // Display results
        if (data.success && data.results) {
            displayResults(data.results);
        } else {
            throw new Error(data.error || 'Unexpected response from server');
        }
    } catch (error) {
        // Show error message
        console.error('Error during triage:', error);
        showError(error.message);
    } finally {
        // Hide loading indicator and re-enable button
        loadingIndicator.classList.add('hidden');
        runButton.disabled = false;
    }
}

/**
 * Display triage results to the user
 * @param {Array} results - Array of result objects from the backend
 */
function displayResults(results) {
    // Show the results section
    resultsSection.classList.remove('hidden');

    // Clear any previous results
    resultsList.innerHTML = '';

    // Create a result card for each telemetry line
    results.forEach((result) => {
        const card = createResultCard(result);
        resultsList.appendChild(card);
    });

    // Scroll to results section
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Create a result card element for a single telemetry line
 * @param {Object} result - Result object containing verdict, confidence, etc.
 * @returns {HTMLElement} - The result card element
 */
function createResultCard(result) {
    // Determine CSS class based on verdict
    const verdictClass = result.verdict.toLowerCase().replace(/\s+/g, '-');

    // Create the card container
    const card = document.createElement('div');
    card.className = `result-card ${verdictClass}`;

    // Line number badge
    const lineNumber = document.createElement('div');
    lineNumber.className = 'result-line-number';
    lineNumber.textContent = `Line ${result.line_number}`;

    // Telemetry text (in monospace font)
    const telemetryDisplay = document.createElement('div');
    telemetryDisplay.className = 'result-telemetry';
    telemetryDisplay.textContent = result.telemetry;

    // Header: verdict + confidence
    const header = document.createElement('div');
    header.className = 'result-header';

    const verdictBadge = document.createElement('div');
    verdictBadge.className = `verdict ${verdictClass}`;
    verdictBadge.textContent = result.verdict;

    const confidenceBadge = document.createElement('div');
    confidenceBadge.className = 'confidence';
    confidenceBadge.textContent = `Confidence: ${(result.confidence * 100).toFixed(0)}%`;

    header.appendChild(verdictBadge);
    header.appendChild(confidenceBadge);

    // Body: explanation + next step
    const body = document.createElement('div');
    body.className = 'result-body';

    // Explanation
    const explanationDiv = document.createElement('div');
    explanationDiv.className = 'result-explanation';
    explanationDiv.innerHTML = `
        <h5>Analysis</h5>
        <p>${escapeHtml(result.explanation)}</p>
    `;

    // Next Step
    const nextStepDiv = document.createElement('div');
    nextStepDiv.className = 'result-next-step';
    nextStepDiv.innerHTML = `
        <h5>Recommended Action</h5>
        <p>${escapeHtml(result.next_step)}</p>
    `;

    body.appendChild(explanationDiv);
    body.appendChild(nextStepDiv);

    // Assemble the card
    card.appendChild(lineNumber);
    card.appendChild(telemetryDisplay);
    card.appendChild(header);
    card.appendChild(body);

    return card;
}

/**
 * Display an error message to the user
 * @param {string} message - Error message text
 */
function showError(message) {
    errorMessage.textContent = message;
    errorAlert.classList.remove('hidden');
}

/**
 * Hide the error alert
 */
function hideError() {
    errorAlert.classList.add('hidden');
}

/**
 * Close an alert by ID (called from HTML onclick)
 * @param {string} alertId - ID of the alert to close
 */
function closeAlert(alertId) {
    document.getElementById(alertId).classList.add('hidden');
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Raw text to escape
 * @returns {string} - HTML-safe text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
