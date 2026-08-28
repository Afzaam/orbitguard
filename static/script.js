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
 * Upload a .txt, .csv, or .pdf file to /api/upload and triage it via Docling.
 * Reuses displayResults() for rendering — no duplication of result logic.
 *
 * PDF files use a stable filename-based key (`pdf::<filename>`) for localStorage
 * so that re-uploading the same PDF always finds the matching override entry,
 * regardless of how Granite's one-sentence summary varies between calls.
 */
async function uploadFile() {
    const file = fileInput.files[0];

    if (!file) {
        showError('Please choose a .txt, .csv, or .pdf file before uploading.');
        return;
    }

    hideError();
    resultsSection.classList.add('hidden');
    resultsList.innerHTML = '';
    loadingIndicator.classList.remove('hidden');
    uploadButton.disabled = true;

    // Derive a stable PDF key BEFORE the API call so save and lookup always agree.
    const ext = file.name.split('.').pop().toLowerCase();
    const pdfKey = (ext === 'pdf') ? ('pdf::' + file.name) : null;

    // DEBUG: log the key that will be searched for on this upload.
    if (pdfKey) {
        console.log('[OrbitGuard PDF] Lookup key for this upload:', pdfKey);
    }

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
            // For PDFs: check override history using an exact key match on the stable
            // filename-based key.  We MUST use getExactEntry here, not findSimilarOverride,
            // because findSimilarOverride relies on uppercase token extraction and
            // "pdf::filename.pdf" contains no uppercase tokens — it would always return null.
            // For txt/csv: pass false (line-by-line path handles its own matching via runTriage).
            const influenced = data.results.map(() => {
                if (pdfKey) {
                    const match = getExactEntry(pdfKey);
                    console.log('[OrbitGuard PDF] wasInfluenced check — getExactEntry result:', match);
                    return match !== null && match.action === 'override';
                }
                return false;
            });
            displayResults(data.results, influenced, pdfKey);
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
 * @param {Array}        results    - Array of result objects from the backend
 * @param {Array}        influenced - Parallel boolean array; true if card was adjusted by prior feedback
 * @param {string|null}  pdfKey     - Stable `pdf::<filename>` key for PDF uploads; null for txt/csv
 */
function displayResults(results, influenced, pdfKey = null) {
    resultsSection.classList.remove('hidden');
    resultsList.innerHTML = '';

    // Render the "Clear Review History" pill once at the panel level (not per-card).
    const clearLink = buildClearHistoryLink();
    resultsList.appendChild(clearLink);

    results.forEach((result, idx) => {
        const wasInfluenced = Array.isArray(influenced) && influenced[idx] === true;
        const card = createResultCard(result, wasInfluenced, pdfKey);
        resultsList.appendChild(card);
    });

    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// ============================================================================
// RESULT CARD
// ============================================================================

/**
 * Create a result card element for a single telemetry line.
 * @param {Object}      result        - Result object containing verdict, confidence, etc.
 * @param {boolean}     wasInfluenced - True if the prompt was adjusted by prior operator feedback
 * @param {string|null} pdfKey        - Stable `pdf::<filename>` key for PDF uploads; null for txt/csv
 * @returns {HTMLElement}
 */
function createResultCard(result, wasInfluenced, pdfKey = null) {
    const verdictClass = result.verdict.toLowerCase().replace(/\s+/g, '-');

    const card = document.createElement('div');
    card.className = `result-card ${verdictClass}`;
    card.style.position = 'relative'; // keeps card as positioning context

    // ---- Line number badge ----
    const lineNumber = document.createElement('div');
    lineNumber.className = 'result-line-number';
    lineNumber.textContent = `Line ${result.line_number}`;

    // ---- Telemetry text ----
    const telemetryDisplay = document.createElement('div');
    telemetryDisplay.className = 'result-telemetry';
    telemetryDisplay.textContent = result.telemetry;

    // ---- Header: verdict + confidence (+ status tag slot) ----
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
    // Status tag (pill badge) is appended here when operator acts — see applyTagToCard()

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

    // For PDF cards, use the stable filename-based key for all localStorage operations.
    // For txt/csv cards, use result.telemetry (the raw log line) as before.
    const storageKey = pdfKey || result.telemetry;

    // ---- Feedback controls ----
    const feedbackRow = buildFeedbackControls(storageKey, card, header);

    // ---- Assemble ----
    card.appendChild(lineNumber);
    card.appendChild(telemetryDisplay);
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(feedbackRow);

    // Restore any saved state from localStorage
    const existing = getExactEntry(storageKey);
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
 * @param {HTMLElement} header    - The result-header element (where the status tag is inserted)
 * @returns {HTMLElement}
 */
function buildFeedbackControls(telemetry, card, header) {
    const row = document.createElement('div');
    row.className = 'feedback-row';

    // ---- Confirm button ----
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'feedback-btn feedback-btn--confirm';
    confirmBtn.innerHTML = '&#10003; Confirm'; // ✓ checkmark icon

    confirmBtn.addEventListener('click', () => {
        recordConfirm(telemetry);
        applyTagToCard(card, 'confirm', header);
        row.style.display = 'none';
    });

    // ---- Log Override button ----
    const overrideBtn = document.createElement('button');
    overrideBtn.type = 'button';
    overrideBtn.className = 'feedback-btn feedback-btn--override';
    overrideBtn.innerHTML = '&#9998; Log Override'; // ✎ pencil/edit icon

    // ---- Override input panel (hidden until Log Override is clicked) ----
    const inputPanel = document.createElement('div');
    inputPanel.className = 'override-input-panel';
    inputPanel.style.display = 'none';

    // Label row: "OPERATOR NOTE" label + live character counter
    const noteLabel = document.createElement('div');
    noteLabel.className = 'override-note-label';

    const noteLabelText = document.createElement('span');
    noteLabelText.className = 'override-note-label-text';
    noteLabelText.textContent = 'Operator Note';

    const noteCounter = document.createElement('span');
    noteCounter.className = 'override-note-counter';
    noteCounter.textContent = '0/150';

    noteLabel.appendChild(noteLabelText);
    noteLabel.appendChild(noteCounter);

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

    // Enable save only when input has text; update live counter on every keystroke
    noteInput.addEventListener('input', () => {
        const len = noteInput.value.length;
        noteCounter.textContent = `${len}/150`;
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
        noteCounter.textContent = '0/150';
        saveBtn.disabled = true;
    });

    saveBtn.addEventListener('click', () => {
        const note = noteInput.value.trim();
        if (!note) return; // guard — should be disabled anyway
        recordOverride(telemetry, note);
        // DEBUG: log the exact key being stored so we can verify it matches on re-upload.
        console.log('[OrbitGuard PDF] Override saved with key:', telemetry);
        applyTagToCard(card, 'override', header);
        row.style.display = 'none';
        showFeedbackSavedToast(card);
    });

    inputPanel.appendChild(noteLabel);
    inputPanel.appendChild(noteInput);
    inputPanel.appendChild(saveBtn);
    inputPanel.appendChild(cancelBtn);

    row.appendChild(confirmBtn);
    row.appendChild(overrideBtn);
    row.appendChild(inputPanel);

    return row;
}

/**
 * Inject a permanent status tag (pill badge) into the result-header row.
 * @param {HTMLElement} card   - The parent card (used for idempotent cleanup)
 * @param {'confirm'|'override'} action
 * @param {HTMLElement} [header] - The result-header element; falls back to querySelector
 */
function applyTagToCard(card, action, header) {
    // Remove any existing tag first (idempotent)
    const existing = card.querySelector('.card-status-tag');
    if (existing) existing.remove();

    const tag = document.createElement('span');
    tag.className = `card-status-tag card-status-tag--${action}`;
    tag.textContent = action === 'confirm' ? '◇ Verdict Confirmed' : '◇ Operator-Flagged';

    // Insert into the header row so the badge sits at top-right beside verdict/confidence
    const targetHeader = header || card.querySelector('.result-header');
    if (targetHeader) {
        targetHeader.appendChild(tag);
    } else {
        card.appendChild(tag);
    }
}

/**
 * Show a "Feedback saved ✓" pill toast that fades in and then persists briefly.
 * @param {HTMLElement} card
 */
function showFeedbackSavedToast(card) {
    const toast = document.createElement('span');
    toast.className = 'feedback-saved-toast';
    toast.innerHTML = '&#10003; Feedback saved'; // ✓ checkmark

    card.appendChild(toast);

    // Trigger fade-in on next frame
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { toast.classList.add('visible'); });
    });

    // Fade out after 5 s (doubled from original 2.5 s), then remove
    setTimeout(() => {
        toast.classList.remove('visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 5000);
}

// ============================================================================
// CLEAR HISTORY LINK + MODAL
// ============================================================================

/**
 * Build the "Clear Review History" pill button for the panel header.
 * Returns the wrapper div (not the full panel header — caller assembles the header).
 * @returns {HTMLElement}
 */
function buildClearHistoryLink() {
    const wrapper = document.createElement('div');
    wrapper.className = 'clear-history-wrapper';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'clear-history-link';
    link.innerHTML = '&#128465; Clear Review History'; // 🗑 trash/bin icon

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
        <div class="modal-icon">&#9203;</div>
        <h4 id="modalTitle" class="modal-title">Clear review history?</h4>
        <p class="modal-body">
            This permanently removes every Confirm and Override record from this session.
            Past verdicts stay as-is, but future triage runs won't be able to reference this feedback.
        </p>
        <div class="modal-actions">
            <button type="button" class="modal-btn modal-btn--cancel" id="modalCancel">Cancel</button>
            <button type="button" class="modal-btn modal-btn--confirm-clear" id="modalConfirmClear">Clear History</button>
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
