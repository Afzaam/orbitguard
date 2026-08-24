/*
  OrbitGuard – Frontend JavaScript

  Handles:
  - Form submission for telemetry input
  - AJAX request to the Flask backend
  - Display of triage results
  - Operator feedback: Confirm / Log Override
  - localStorage persistence of review history
  - Prompt augmentation with prior operator overrides
  - UI state management (loading, errors, etc.)
*/

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const triageForm       = document.getElementById('triageForm');
const telemetryInput   = document.getElementById('telemetryInput');
const runButton        = document.getElementById('runButton');
const clearButton      = document.getElementById('clearButton');
const uploadButton     = document.getElementById('uploadButton');
const fileInput        = document.getElementById('fileInput');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorAlert       = document.getElementById('errorAlert');
const errorMessage     = document.getElementById('errorMessage');
const resultsSection   = document.getElementById('resultsSection');
const resultsList      = document.getElementById('resultsList');

// ============================================================================
// LOCALSTORAGE REVIEW-HISTORY MODULE
// Key: 'orbitguard_review_history'
// Shape: Array of { telemetry: string, action: 'confirm'|'override', note: string|null }
// ============================================================================

const HISTORY_KEY = 'orbitguard_review_history';

/**
 * Load the full review history from localStorage.
 * @returns {Array}
 */
function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

/**
 * Persist the full review history to localStorage.
 * @param {Array} history
 */
function saveHistory(history) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (_) {
        // Storage full or private browsing — fail silently.
    }
}

/**
 * Record a Confirm action for a telemetry line.
 * Replaces any existing entry for the same line.
 * @param {string} telemetry
 */
function recordConfirm(telemetry) {
    const history = loadHistory();
    const idx = history.findIndex(e => e.telemetry === telemetry);
    const entry = { telemetry, action: 'confirm', note: null };
    if (idx >= 0) history[idx] = entry; else history.push(entry);
    saveHistory(history);
}

/**
 * Record an Override action with an operator note.
 * Replaces any existing entry for the same line.
 * @param {string} telemetry
 * @param {string} note
 */
function recordOverride(telemetry, note) {
    const history = loadHistory();
    const idx = history.findIndex(e => e.telemetry === telemetry);
    const entry = { telemetry, action: 'override', note };
    if (idx >= 0) history[idx] = entry; else history.push(entry);
    saveHistory(history);
}

/**
 * Wipe the entire review history from localStorage.
 */
function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
}

/**
 * Look up any existing review entry for an exact telemetry line.
 * @param {string} telemetry
 * @returns {{ action: string, note: string|null }|null}
 */
function getExactEntry(telemetry) {
    const history = loadHistory();
    return history.find(e => e.telemetry === telemetry) || null;
}

// ============================================================================
// KEYWORD MATCHING
// "Similar" = shares at least one uppercase sensor/parameter token
// Tokens are runs of UPPERCASE letters + digits + underscores (≥3 chars).
// ============================================================================

/**
 * Extract sensor/parameter keyword tokens from a telemetry string.
 * Examples: SIGNAL_STRENGTH, COMMAND_RECV, SENSOR_TEMP
 * @param {string} text
 * @returns {Set<string>}
 */
function extractTokens(text) {
    const tokens = new Set();
    // Match sequences of uppercase letters, digits, and underscores (min 3 chars)
    const matches = text.match(/[A-Z][A-Z0-9_]{2,}/g);
    if (matches) matches.forEach(t => tokens.add(t));
    return tokens;
}

/**
 * Return true if two telemetry strings share at least one sensor token.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isSimilarTelemetry(a, b) {
    const ta = extractTokens(a);
    const tb = extractTokens(b);
    for (const token of ta) {
        if (tb.has(token)) return true;
    }
    return false;
}

/**
 * Find the first override history entry whose telemetry is similar to the given line.
 * @param {string} telemetry
 * @returns {{ telemetry: string, action: string, note: string }|null}
 */
function findSimilarOverride(telemetry) {
    const history = loadHistory();
    for (const entry of history) {
        if (entry.action === 'override' && entry.note && isSimilarTelemetry(telemetry, entry.telemetry)) {
            return entry;
        }
    }
    return null;
}

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
 * Send telemetry data to the backend for triage analysis.
 * Injects per-line operator notes into the request for Granite.
 */
async function runTriage() {
    const telemetryText = telemetryInput.value.trim();

    if (!telemetryText) {
        showError('Please paste telemetry data before running triage.');
        return;
    }

    hideError();
    resultsSection.classList.add('hidden');
    resultsList.innerHTML = '';
    loadingIndicator.classList.remove('hidden');
    runButton.disabled = true;

    // Build per-line operator notes from override history
    const lines = telemetryText.split('\n').map(l => l.trim()).filter(Boolean);
    const operatorNotes = lines.map(line => {
        const similar = findSimilarOverride(line);
        return similar ? similar.note : null;
    });

    // DEBUG: trace operator notes and similarity matches before sending
    console.group('[OrbitGuard DEBUG] runTriage() — operator note injection');
    lines.forEach((line, i) => {
        const similar = findSimilarOverride(line);
        console.log(`Line ${i + 1}: "${line}"`);
        console.log(`  → findSimilarOverride result:`, similar);
        console.log(`  → operatorNotes[${i}]:`, operatorNotes[i]);
    });
    console.log('Full operatorNotes array being sent:', operatorNotes);
    console.log('Full localStorage history:', loadHistory());
    console.groupEnd();

    try {
        const response = await fetch('/api/triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telemetry: telemetryText,
                operator_notes: operatorNotes,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to run triage');
        }

        const data = await response.json();

        if (data.success && data.results) {
            // Tag which results were influenced by prior operator feedback
            const influenced = lines.map(line => findSimilarOverride(line) !== null);
            // DEBUG: trace influenced array vs results count
            console.group('[OrbitGuard DEBUG] Post-fetch influenced array');
            console.log('lines.length:', lines.length, '| results.length:', data.results.length);
            console.log('influenced[]:', influenced);
            data.results.forEach((r, idx) => {
                console.log(`  results[${idx}] line_number=${r.line_number} verdict=${r.verdict} | influenced[${idx}]=${influenced[idx]}`);
            });
            console.groupEnd();
            displayResults(data.results, influenced);
        } else {
            throw new Error(data.error || 'Unexpected response from server');
        }
    } catch (error) {
        console.error('Error during triage:', error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add('hidden');
        runButton.disabled = false;
    }
}

/**
 * Upload a .txt or .csv file to /api/upload and triage it via Docling.
 * Reuses displayResults() for rendering — no duplication of result logic.
 */
async function uploadFile() {
    const file = fileInput.files[0];

    if (!file) {
        showError('Please choose a .txt or .csv file before uploading.');
        return;
    }

    hideError();
    resultsSection.classList.add('hidden');
    resultsList.innerHTML = '';
    loadingIndicator.classList.remove('hidden');
    uploadButton.disabled = true;

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to process uploaded file');
        }

        if (data.success && data.results) {
            displayResults(data.results, data.results.map(() => false));
        } else {
            throw new Error(data.error || 'Unexpected response from server');
        }
    } catch (error) {
        console.error('Error during file upload triage:', error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.remove('hidden');
        loadingIndicator.classList.add('hidden');
        uploadButton.disabled = false;
        fileInput.value = '';
    }
}

/**
 * Display triage results to the user.
 * @param {Array}   results    - Array of result objects from the backend
 * @param {Array}   influenced - Parallel boolean array; true if card was adjusted by prior feedback
 */
function displayResults(results, influenced) {
    resultsSection.classList.remove('hidden');
    resultsList.innerHTML = '';

    // Render the "Clear Review History" link before the cards
    const clearLink = buildClearHistoryLink();
    resultsList.appendChild(clearLink);

    results.forEach((result, idx) => {
        const wasInfluenced = Array.isArray(influenced) && influenced[idx] === true;
        const card = createResultCard(result, wasInfluenced);
        resultsList.appendChild(card);
    });

    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// ============================================================================
// RESULT CARD
// ============================================================================

/**
 * Create a result card element for a single telemetry line.
 * @param {Object}  result        - Result object containing verdict, confidence, etc.
 * @param {boolean} wasInfluenced - True if the prompt was adjusted by prior operator feedback
 * @returns {HTMLElement}
 */
function createResultCard(result, wasInfluenced) {
    const verdictClass = result.verdict.toLowerCase().replace(/\s+/g, '-');

    const card = document.createElement('div');
    card.className = `result-card ${verdictClass}`;
    card.style.position = 'relative'; // needed for absolute-positioned tag

    // ---- Line number badge ----
    const lineNumber = document.createElement('div');
    lineNumber.className = 'result-line-number';
    lineNumber.textContent = `Line ${result.line_number}`;

    // ---- Telemetry text ----
    const telemetryDisplay = document.createElement('div');
    telemetryDisplay.className = 'result-telemetry';
    telemetryDisplay.textContent = result.telemetry;

    // ---- Header: verdict + confidence ----
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

    // ---- Body: explanation + next step ----
    const body = document.createElement('div');
    body.className = 'result-body';

    const explanationDiv = document.createElement('div');
    explanationDiv.className = 'result-explanation';
    explanationDiv.innerHTML = `
        <h5>Analysis</h5>
        <p>${escapeHtml(result.explanation)}</p>
    `;

    // "Adjusted from operator feedback" line, shown inside the explanation box
    if (wasInfluenced) {
        const adjustedNote = document.createElement('p');
        adjustedNote.className = 'feedback-adjusted-note';
        adjustedNote.textContent = 'Adjusted from operator feedback on a similar reading.';
        explanationDiv.appendChild(adjustedNote);
    }

    const nextStepDiv = document.createElement('div');
    nextStepDiv.className = 'result-next-step';
    nextStepDiv.innerHTML = `
        <h5>Recommended Action</h5>
        <p>${escapeHtml(result.next_step)}</p>
    `;

    body.appendChild(explanationDiv);
    body.appendChild(nextStepDiv);

    // ---- Feedback controls ----
    const feedbackRow = buildFeedbackControls(result.telemetry, card);

    // ---- Assemble ----
    card.appendChild(lineNumber);
    card.appendChild(telemetryDisplay);
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(feedbackRow);

    // Restore any saved state from localStorage
    const existing = getExactEntry(result.telemetry);
    if (existing) {
        applyTagToCard(card, existing.action);
        // Hide feedback controls — operator already acted
        feedbackRow.style.display = 'none';
    }

    return card;
}

// ============================================================================
// FEEDBACK CONTROLS
// ============================================================================

/**
 * Build the Confirm / Log Override control row for a result card.
 * @param {string}      telemetry - The raw telemetry text (used as the record key)
 * @param {HTMLElement} card      - The parent card element (for tag injection)
 * @returns {HTMLElement}
 */
function buildFeedbackControls(telemetry, card) {
    const row = document.createElement('div');
    row.className = 'feedback-row';

    // ---- Confirm button ----
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'feedback-btn feedback-btn--confirm';
    confirmBtn.textContent = 'Confirm';

    confirmBtn.addEventListener('click', () => {
        recordConfirm(telemetry);
        applyTagToCard(card, 'confirm');
        row.style.display = 'none';
    });

    // ---- Log Override button ----
    const overrideBtn = document.createElement('button');
    overrideBtn.type = 'button';
    overrideBtn.className = 'feedback-btn feedback-btn--override';
    overrideBtn.textContent = 'Log Override';

    // ---- Override input panel (hidden until Log Override is clicked) ----
    const inputPanel = document.createElement('div');
    inputPanel.className = 'override-input-panel';
    inputPanel.style.display = 'none';

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'override-note-input';
    noteInput.maxLength = 150;
    noteInput.placeholder = 'Reason (e.g. known sensor issue) — 150 chars max';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'feedback-btn feedback-btn--save';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true; // disabled until text is typed

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'feedback-btn feedback-btn--cancel';
    cancelBtn.textContent = 'Cancel';

    // Enable save only when input has text
    noteInput.addEventListener('input', () => {
        saveBtn.disabled = noteInput.value.trim().length === 0;
    });

    overrideBtn.addEventListener('click', () => {
        inputPanel.style.display = 'flex';
        overrideBtn.style.display = 'none';
        confirmBtn.style.display = 'none';
        noteInput.focus();
    });

    cancelBtn.addEventListener('click', () => {
        inputPanel.style.display = 'none';
        overrideBtn.style.display = '';
        confirmBtn.style.display = '';
        noteInput.value = '';
        saveBtn.disabled = true;
    });

    saveBtn.addEventListener('click', () => {
        const note = noteInput.value.trim();
        if (!note) return; // guard — should be disabled anyway
        recordOverride(telemetry, note);
        applyTagToCard(card, 'override');
        row.style.display = 'none';
        showFeedbackSavedToast(card);
    });

    inputPanel.appendChild(noteInput);
    inputPanel.appendChild(saveBtn);
    inputPanel.appendChild(cancelBtn);

    row.appendChild(confirmBtn);
    row.appendChild(overrideBtn);
    row.appendChild(inputPanel);

    return row;
}

/**
 * Inject a permanent status tag into a card corner.
 * @param {HTMLElement} card
 * @param {'confirm'|'override'} action
 */
function applyTagToCard(card, action) {
    // Remove any existing tag first (idempotent)
    const existing = card.querySelector('.card-status-tag');
    if (existing) existing.remove();

    const tag = document.createElement('span');
    tag.className = `card-status-tag card-status-tag--${action}`;
    tag.textContent = action === 'confirm' ? '⟡ Verdict Confirmed' : '⟡ Operator-flagged';
    card.appendChild(tag);
}

/**
 * Show a "Feedback saved ✓" toast that fades in and then persists briefly.
 * @param {HTMLElement} card
 */
function showFeedbackSavedToast(card) {
    const toast = document.createElement('span');
    toast.className = 'feedback-saved-toast';
    toast.textContent = 'Feedback saved ✓';
    card.appendChild(toast);

    // Trigger fade-in on next frame
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { toast.classList.add('visible'); });
    });

    // Fade out after 2.5 s, then remove
    setTimeout(() => {
        toast.classList.remove('visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 2500);
}

// ============================================================================
// CLEAR HISTORY LINK + MODAL
// ============================================================================

/**
 * Build the unobtrusive "Clear Review History" link shown above the cards.
 * @returns {HTMLElement}
 */
function buildClearHistoryLink() {
    const wrapper = document.createElement('div');
    wrapper.className = 'clear-history-wrapper';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'clear-history-link';
    link.textContent = '⊘ Clear Review History';

    link.addEventListener('click', () => showClearHistoryModal());

    wrapper.appendChild(link);
    return wrapper;
}

/**
 * Show the confirmation modal before clearing history.
 */
function showClearHistoryModal() {
    // Remove any leftover modal
    const existing = document.getElementById('clearHistoryModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'clearHistoryModal';
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'modalTitle');

    dialog.innerHTML = `
        <h4 id="modalTitle" class="modal-title">⚠️ Clear Review History</h4>
        <p class="modal-body">
            This will permanently clear all Confirmed and Operator-flagged history
            for this session. This cannot be undone.
        </p>
        <div class="modal-actions">
            <button type="button" class="modal-btn modal-btn--cancel" id="modalCancel">Cancel</button>
            <button type="button" class="modal-btn modal-btn--confirm-clear" id="modalConfirmClear">Yes, Clear History</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Close on overlay click (outside dialog)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeClearHistoryModal();
    });

    document.getElementById('modalCancel').addEventListener('click', closeClearHistoryModal);
    document.getElementById('modalConfirmClear').addEventListener('click', () => {
        clearHistory();
        closeClearHistoryModal();
        // Re-render results: clear all tags and re-show feedback controls
        document.querySelectorAll('.result-card').forEach(card => {
            const tag = card.querySelector('.card-status-tag');
            if (tag) tag.remove();
            const feedbackRow = card.querySelector('.feedback-row');
            if (feedbackRow) feedbackRow.style.display = '';
        });
    });

    // Trap focus — focus the Cancel button
    setTimeout(() => {
        const cancelBtn = document.getElementById('modalCancel');
        if (cancelBtn) cancelBtn.focus();
    }, 50);
}

function closeClearHistoryModal() {
    const modal = document.getElementById('clearHistoryModal');
    if (modal) modal.remove();
}

// ============================================================================
// ERROR / UTILITY HELPERS
// ============================================================================

function showError(message) {
    errorMessage.textContent = message;
    errorAlert.classList.remove('hidden');
}

function hideError() {
    errorAlert.classList.add('hidden');
}

function closeAlert(alertId) {
    document.getElementById(alertId).classList.add('hidden');
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
