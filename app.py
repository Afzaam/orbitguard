"""
OrbitGuard - AI Triage Assistant for Space-Mission Operators
Stage 2: IBM Granite via watsonx integration

HOW THE WATSONX CONNECTION WORKS (for demo explanation):
---------------------------------------------------------
1. When Flask starts, we read three credentials from the .env file:
     - WATSONX_API_KEY   : your IBM Cloud API key (authenticates you)
     - WATSONX_PROJECT_ID: the watsonx project that owns your usage quota
     - WATSONX_URL       : the regional endpoint (e.g. us-south)

2. We create a ModelInference client pointing at "ibm/granite-4-h-small".
   This is like opening a phone line to Granite — it stays open for the
   life of the Flask process so we don't re-authenticate on every request.

3. When the operator clicks "Run Triage", the /api/triage route:
     a. Takes the pasted telemetry text
     b. Wraps it in a structured prompt that instructs Granite to act as a
        space-mission cybersecurity expert and return a JSON array
     c. Sends the prompt to watsonx and receives Granite's response text
     d. Parses the JSON out of that response text
     e. Returns it to the browser in the same shape the UI already expects

4. If anything goes wrong (network, bad API key, malformed JSON from the
   model), the except block catches it and returns safe mock results instead,
   so the app never crashes or shows a blank screen.

IBM Bob is the primary development tool.
"""

import os
import json
import re
import logging
import time
import tempfile
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Set up logging so errors appear in the terminal during development
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)


# ============================================================================
# WATSONX CLIENT SETUP
# Initialised once at startup — not on every request.
# ============================================================================

# Read credentials from .env
WATSONX_API_KEY    = os.getenv('WATSONX_API_KEY')
WATSONX_PROJECT_ID = os.getenv('WATSONX_PROJECT_ID')
WATSONX_URL        = os.getenv('WATSONX_URL', 'https://api.us-south.ml.cloud.ibm.com')

# The IBM Granite model we want to use for analysis.
# granite-13b-chat-v2 is well-suited to instruction-following and JSON output.
GRANITE_MODEL_ID = 'ibm/granite-4-h-small'

# Try to create the watsonx client. If credentials are missing or the SDK
# isn't installed yet, granite_model will be None and we fall back to mocks.
granite_model = None

# ============================================================================
# DOCLING SETUP
# Imported lazily so the app still runs if docling isn't installed yet.
# ============================================================================

# Disable torch.compile() inside Docling before anything is imported.
# Docling's inference engine calls torch.compile() by default for speed, but
# that requires a C++ compiler (cl.exe on Windows) which is not present on
# this machine.  Setting this env var tells Docling's settings layer to skip
# compilation entirely; models run in normal (eager) mode instead.
# Must be set before DocumentConverter is imported so the settings object
# reads the correct value at class-definition time.
os.environ.setdefault('DOCLING_INFERENCE_COMPILE_TORCH_MODELS', 'false')

docling_available = False
try:
    from docling.document_converter import DocumentConverter as _DoclingConverter
    _docling_converter = _DoclingConverter()
    docling_available = True
    logger.info("✅ IBM Docling available for file uploads.")
except Exception as _e:
    logger.warning(f"⚠️  Docling not available: {_e}. File upload will be disabled.")

# ============================================================================
# WATSONX CLIENT SETUP
# Initialised once at startup — not on every request.
# ============================================================================

try:
    from ibm_watsonx_ai import Credentials
    from ibm_watsonx_ai.foundation_models import ModelInference
    from ibm_watsonx_ai.metanames import GenTextParamsMetaNames as GenParams

    if WATSONX_API_KEY and WATSONX_PROJECT_ID:
        credentials = Credentials(
            url=WATSONX_URL,
            api_key=WATSONX_API_KEY,
        )
        granite_model = ModelInference(
            model_id=GRANITE_MODEL_ID,
            credentials=credentials,
            project_id=WATSONX_PROJECT_ID,
            params={
                # Max tokens to generate — enough for a full JSON array response
                GenParams.MAX_NEW_TOKENS: 1200,
                # Keep responses focused and deterministic
                GenParams.TEMPERATURE: 0.2,
                # Stop generating once we hit the closing bracket of the JSON array
                GenParams.STOP_SEQUENCES: ['```'],
            },
        )
        logger.info("✅ IBM Granite client initialised successfully.")
    else:
        logger.warning("⚠️  WATSONX_API_KEY or WATSONX_PROJECT_ID not set — running in mock mode.")

except Exception as e:
    logger.warning(f"⚠️  Could not initialise watsonx client: {e}. Running in mock mode.")


# ============================================================================
# PROMPT BUILDERS
# ============================================================================

def build_triage_prompt(telemetry_text: str, operator_note: str = None) -> str:
    """
    Build the structured prompt sent to IBM Granite for a single telemetry
    line (used by the paste-text and .txt/.csv upload paths).

    If operator_note is provided, a context line is prepended so Granite
    can account for the operator's prior override of a similar reading.

    We give Granite a clear role (space-mission cybersecurity expert),
    a strict output format (JSON array), and the actual telemetry lines
    to analyse. Asking for JSON makes parsing the response reliable.
    """
    lines = [l.strip() for l in telemetry_text.strip().splitlines() if l.strip()]
    numbered_lines = "\n".join(f"{i+1}. {line}" for i, line in enumerate(lines))

    # Prepend operator feedback context when available
    operator_context = ""
    # DEBUG: log whether an operator note reached this function
    logger.info(f"[DEBUG build_triage_prompt] operator_note={operator_note!r}")
    if operator_note:
        operator_context = (
            f"Operator context: a human operator previously flagged a similar reading with this note: "
            f"\"{operator_note}\"\n\n"
            f"When producing the 'explanation' field, you MUST follow one of the two strict templates below "
            f"depending on the severity of the current reading. Severity is assessed from the telemetry text "
            f"itself — look for keywords such as CRITICAL, INVALID, unauthorized, unregistered, "
            f"authentication failure, or command-and-control signals.\n\n"
            f"TEMPLATE A — use when the reading is LOW-TO-MODERATE risk (no safety-critical keywords present) "
            f"AND the operator's note plausibly explains it as a known, non-malicious condition:\n"
            f"  First sentence (REQUIRED, FIXED OPENING): \"Consistent with the operator's prior note that "
            f"[3-6 word summary of the operator's note], [brief reasoning for the calmer verdict].\"\n"
            f"  Second sentence: one additional supporting observation, if needed. Maximum 2 sentences total.\n"
            f"  Also shift the verdict toward Normal or meaningfully lower the confidence for "
            f"Suspicious/Likely Attack.\n"
            f"  Example: \"Consistent with the operator's prior note that antenna repositioning causes "
            f"signal drops, this weak reading is consistent with a scheduled manoeuvre rather than "
            f"interference.\"\n\n"
            f"TEMPLATE B — use when the reading is HIGH risk or safety-critical (contains CRITICAL, INVALID, "
            f"unregistered, unauthorized, authentication failure, or command-and-control signals):\n"
            f"  Your explanation should open by acknowledging the operator's note, then explain why caution "
            f"is still warranted despite it. Do not significantly lower the verdict or confidence.\n"
            f"  Example: \"The operator previously flagged a similar reading as routine sensor calibration; "
            f"however, the CRITICAL flag and authentication failure indicate this requires independent "
            f"verification before any action is taken.\"\n"
            f"  Maximum 2 sentences total.\n\n"
        )

    prompt = f"""{operator_context}You are an expert space-mission cybersecurity analyst. Your job is to triage spacecraft and ground-station telemetry logs and identify signs of cyberattack versus normal operation or hardware malfunction.

For each telemetry line below, analyse it and respond with a JSON array. Each item in the array must have exactly these fields:
- "line_number": integer (1-based)
- "telemetry": the original log line (copy it exactly)
- "verdict": one of "Normal", "Suspicious", or "Likely Attack"
- "confidence": a float between 0.0 and 1.0
- "explanation": a plain-English sentence (max 2 sentences) explaining why
- "next_step": a concrete action the human operator should take next

Output ONLY the JSON array — nothing before the opening [ and nothing after the closing ]. No explanation, no markdown fences, no trailing text of any kind.

Telemetry lines to analyse:
{numbered_lines}

JSON response:
"""
    return prompt


def build_incident_report_prompt(report_text: str) -> str:
    """
    Build a prompt for a PDF mission incident report.

    Unlike the telemetry prompt, the entire document is treated as one
    unit of analysis — not split into lines.  Granite is asked to return
    a JSON array containing exactly ONE item that summarises the whole
    report: overall verdict, confidence, explanation, and recommended
    next action for the human operator.
    """
    prompt = f"""You are an expert space-mission cybersecurity analyst reviewing a mission incident report submitted by a ground control team.

Read the full incident report below and provide a single overall triage assessment of it. Respond with a JSON array containing exactly ONE object with these fields:
- "line_number": 1
- "telemetry": a one-sentence summary of what the report is about (max 20 words)
- "verdict": one of "Normal", "Suspicious", or "Likely Attack"
- "confidence": a float between 0.0 and 1.0
- "explanation": 2–3 plain-English sentences summarising the key findings and why you reached this verdict
- "next_step": a concrete action the human operator should take next based on the report contents

Output ONLY the JSON array — nothing before the opening [ and nothing after the closing ]. No explanation, no markdown fences, no trailing text of any kind.

Mission incident report:
{report_text.strip()}

JSON response:
"""
    return prompt


# ============================================================================
# RESPONSE PARSER
# ============================================================================

def parse_granite_response(raw_response: str, telemetry_text: str) -> list:
    """
    Extract and validate the JSON array from Granite's response text.

    Granite sometimes wraps JSON in markdown fences, adds a preamble, or
    appends stray text after the closing bracket — all of which make a naive
    json.loads call fail with "Extra data".

    Strategy:
      1. Strip markdown code fences (``` … ```).
      2. Locate the first '[' in the cleaned text.
      3. Walk forward character-by-character tracking bracket depth to find
         the exact matching ']', ignoring any text outside that span.
         This avoids the greedy-regex trap where r'\[.*\]' with DOTALL
         either undershoots (non-greedy) or includes trailing content.
      4. Parse only that extracted slice.
      5. On any parse failure, log the full raw Granite response to the
         terminal so future debugging is instant.
    """
    # Step 1 — strip markdown code fences
    cleaned = re.sub(r'```(?:json)?\s*', '', raw_response).strip()

    # Step 2 — find the opening bracket
    start = cleaned.find('[')
    if start == -1:
        logger.error(
            "parse_granite_response: no '[' found in Granite output.\n"
            "--- RAW GRANITE RESPONSE ---\n%s\n--- END ---", raw_response
        )
        raise ValueError("No JSON array found in Granite response")

    # Step 3 — walk to the matching closing bracket using depth counting
    depth = 0
    in_string = False
    escape_next = False
    end = -1
    for i, ch in enumerate(cleaned[start:], start=start):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0:
                end = i
                break

    if end == -1:
        logger.error(
            "parse_granite_response: unmatched '[' — could not find closing ']'.\n"
            "--- RAW GRANITE RESPONSE ---\n%s\n--- END ---", raw_response
        )
        raise ValueError("Unmatched '[' in Granite response — JSON array is incomplete")

    # Step 4 — parse only the exact slice
    json_slice = cleaned[start:end + 1]
    try:
        results = json.loads(json_slice)
    except json.JSONDecodeError as exc:
        logger.error(
            "parse_granite_response: json.loads failed (%s).\n"
            "--- EXTRACTED SLICE ---\n%s\n"
            "--- RAW GRANITE RESPONSE ---\n%s\n--- END ---",
            exc, json_slice, raw_response
        )
        raise ValueError(f"JSON decode error in Granite response: {exc}") from exc

    # Validate and normalise each result so the frontend never breaks
    lines = [l.strip() for l in telemetry_text.strip().splitlines() if l.strip()]
    required_keys = {'line_number', 'telemetry', 'verdict', 'confidence', 'explanation', 'next_step'}
    valid_verdicts = {'Normal', 'Suspicious', 'Likely Attack'}

    normalised = []
    for i, item in enumerate(results):
        if not required_keys.issubset(item.keys()):
            raise ValueError(f"Result item {i} missing required keys")
        # Clamp confidence to [0, 1]
        item['confidence'] = max(0.0, min(1.0, float(item['confidence'])))
        # Normalise verdict casing
        if item['verdict'] not in valid_verdicts:
            item['verdict'] = 'Suspicious'
        normalised.append(item)

    return normalised


# ============================================================================
# MOCK FALLBACKS
# Returns safe placeholder results if the watsonx call fails.
# ============================================================================

def get_mock_results(telemetry_text: str) -> list:
    """
    Return per-line mock results based on the actual pasted lines.
    Used as a fallback when the watsonx API call fails for .txt/.csv uploads
    or pasted telemetry.
    """
    lines = [l.strip() for l in telemetry_text.strip().splitlines() if l.strip()]
    mock_results = []
    for i, line in enumerate(lines):
        mock_results.append({
            'line_number': i + 1,
            'telemetry': line,
            'verdict': 'Suspicious',
            'confidence': 0.5,
            'explanation': 'AI analysis unavailable — this is a placeholder result. Check your watsonx credentials.',
            'next_step': 'Review this line manually and verify your API connection.'
        })
    return mock_results


def get_mock_result_for_document() -> list:
    """
    Return a single mock result for a PDF incident report.
    Used as a fallback when the watsonx API call fails for PDF uploads.
    """
    return [{
        'line_number': 1,
        'telemetry': 'Mission incident report (AI analysis unavailable)',
        'verdict': 'Suspicious',
        'confidence': 0.5,
        'explanation': 'AI analysis unavailable — this is a placeholder result. Check your watsonx credentials.',
        'next_step': 'Review the incident report manually and verify your API connection.'
    }]


# ============================================================================
# DOCLING TEXT EXTRACTOR
# ============================================================================

def extract_text_with_docling(file_path: str) -> str:
    """
    Use IBM Docling to extract text from a file at file_path.

    For plain-text files (.txt, .csv) this returns the document's text
    directly via export_to_text().

    For PDF files this walks every item in the document in reading order
    using iterate_items() so that narrative paragraphs and table data are
    both captured:
      - TextItem  → raw text, appended as-is
      - TableItem → rendered as a compact Markdown table so row/column
                    structure is preserved and readable by Granite

    The two content types are joined with blank-line separators into one
    coherent text block that feeds straight into the triage pipeline.

    Raises RuntimeError with a friendly message on any failure (including
    scanned-image PDFs that yield no extractable text).
    """
    if not docling_available:
        raise RuntimeError("File upload is not available — Docling library is not installed.")

    try:
        result = _docling_converter.convert(file_path)
        doc = result.document
    except Exception as e:
        logger.error(f"Docling conversion failed for '{file_path}': {e}")
        raise RuntimeError(
            "Couldn't read this file — it may be a scanned image, corrupted, "
            "or in an unsupported format. Please check the file and try again."
        )

    # For non-PDF files the fast path is sufficient.
    ext = os.path.splitext(file_path)[1].lower()
    if ext != '.pdf':
        return doc.export_to_text()

    # PDF path: walk items in document order, preserving tables as Markdown.
    from docling.datamodel.document import TextItem, TableItem

    segments = []
    try:
        for item, _ in doc.iterate_items():
            if isinstance(item, TableItem):
                # Render as Markdown so column/row structure survives as
                # readable lines (e.g. "| Time | Sensor | Value |")
                table_md = item.export_to_markdown()
                if table_md.strip():
                    segments.append(f"[TABLE]\n{table_md.strip()}\n[/TABLE]")
            elif isinstance(item, TextItem):
                text = item.text.strip() if item.text else ""
                if text:
                    segments.append(text)
    except Exception as e:
        logger.error(f"Docling item iteration failed: {e}")
        raise RuntimeError(
            "Couldn't read this file — it may be a scanned image, corrupted, "
            "or in an unsupported format. Please check the file and try again."
        )

    combined = "\n\n".join(segments)

    if not combined.strip():
        raise RuntimeError(
            "No readable text was found in this PDF — it may be a scanned "
            "image without embedded text. Please use a text-based PDF."
        )

    return combined


# ============================================================================
# ROUTES
# ============================================================================

@app.route('/')
def home():
    """Render the main OrbitGuard UI."""
    return render_template('index.html')


@app.route('/api/triage', methods=['POST'])
def triage():
    """
    Receive telemetry data and return AI triage results.

    Sends the telemetry to IBM Granite via watsonx, parses the JSON response,
    and returns it to the frontend. Falls back to mock results on any error.
    """
    data = request.get_json()
    telemetry_text = data.get('telemetry', '')

    if not telemetry_text:
        return jsonify({'error': 'No telemetry data provided'}), 400

    # ------------------------------------------------------------------
    # Try IBM Granite via watsonx
    # Send one request per telemetry line, sequentially, with a short
    # delay between each to stay under the free-tier rate limit.
    # ------------------------------------------------------------------
    # Extract optional per-line operator notes sent by the frontend
    operator_notes = data.get('operator_notes') or []

    # DEBUG: log what the backend actually received
    logger.info(f"[DEBUG /api/triage] operator_notes received from frontend: {operator_notes!r}")

    if granite_model is not None:
        try:
            lines = [l.strip() for l in telemetry_text.strip().splitlines() if l.strip()]
            results = []

            for i, line in enumerate(lines):
                logger.info(f"Sending line {i + 1}/{len(lines)} to IBM Granite...")
                # Use per-line operator note if available
                op_note = operator_notes[i] if i < len(operator_notes) else None
                # DEBUG: log per-line note resolution
                logger.info(f"[DEBUG] Line {i + 1} op_note={op_note!r} | line={line!r}")
                prompt = build_triage_prompt(line, operator_note=op_note)

                # Retry up to 2 times on empty or unparseable responses.
                max_attempts = 3
                line_results = None
                last_exc = None
                for attempt in range(1, max_attempts + 1):
                    if attempt > 1:
                        logger.warning(f"Retry {attempt - 1}/{max_attempts - 1} for line {i + 1} after empty/unparseable response — waiting 2s...")
                        time.sleep(2)
                    try:
                        response = granite_model.generate_text(prompt=prompt)
                        # parse_granite_response expects the original text to rebuild
                        # line numbers — pass the single line so it stays consistent.
                        line_results = parse_granite_response(response, line)
                        break  # success — exit retry loop
                    except (ValueError, Exception) as exc:
                        last_exc = exc
                        logger.warning(f"Attempt {attempt}/{max_attempts} failed for line {i + 1}: {exc}")

                if line_results is None:
                    # All attempts exhausted — re-raise so the outer except falls back to mock.
                    raise last_exc

                # Re-stamp the line number relative to the full input.
                for item in line_results:
                    item['line_number'] = i + 1
                results.extend(line_results)

                # Pause between requests to avoid 429 Too Many Requests.
                if i < len(lines) - 1:
                    time.sleep(1)

            logger.info(f"✅ Granite returned {len(results)} triage result(s).")

            return jsonify({
                'success': True,
                'message': 'Triage complete (IBM Granite)',
                'results': results
            })

        except Exception as e:
            # Log the error but don't crash — fall through to mock results
            logger.error(f"❌ watsonx call failed: {e}. Falling back to mock results.")

    # ------------------------------------------------------------------
    # Fallback: mock results (watsonx unavailable or call failed)
    # ------------------------------------------------------------------
    results = get_mock_results(telemetry_text)
    return jsonify({
        'success': True,
        'message': 'Triage complete (mock mode — check API connection)',
        'results': results
    })


@app.route('/api/upload', methods=['POST'])
def upload():
    """
    Accept a .txt, .csv, or .pdf file upload, extract its text with IBM
    Docling (for PDFs: narrative text + tables preserved as Markdown),
    then run the exact same triage analysis as /api/triage.

    Returns the same JSON shape as /api/triage so the frontend can reuse
    the same displayResults() logic without any duplication.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file included in the request'}), 400

    uploaded_file = request.files['file']

    if not uploaded_file.filename:
        return jsonify({'error': 'No file selected'}), 400

    # Enforce allowed extensions
    allowed_extensions = {'.txt', '.csv', '.pdf'}
    _, ext = os.path.splitext(uploaded_file.filename.lower())
    if ext not in allowed_extensions:
        return jsonify({'error': 'Only .txt, .csv, and .pdf files are supported'}), 400

    # Save to a temp file so Docling can read it from disk
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
            uploaded_file.save(tmp_path)

        logger.info(f"Extracting text from uploaded file '{uploaded_file.filename}' via Docling...")
        telemetry_text = extract_text_with_docling(tmp_path)
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 422
    except Exception as e:
        logger.error(f"Unexpected error during file extraction: {e}")
        return jsonify({'error': "Couldn't read this file — please check the format and try again."}), 422
    finally:
        # Always clean up the temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    if not telemetry_text or not telemetry_text.strip():
        return jsonify({'error': 'The uploaded file appears to be empty or contained no readable text'}), 422

    # ------------------------------------------------------------------
    # Triage the extracted content.
    #
    # PDF (mission incident report): send the entire document as ONE
    # request — the report is coherent prose, not a list of log lines.
    #
    # .txt / .csv (telemetry log): keep the existing line-by-line loop
    # with a 1-second delay between requests, unchanged.
    # ------------------------------------------------------------------
    logger.info(f"File extracted successfully ({len(telemetry_text.splitlines())} lines). Running triage...")

    if ext == '.pdf':
        # ---- PDF: single whole-document request ----
        if granite_model is not None:
            try:
                logger.info("[upload] Sending full PDF incident report to IBM Granite...")
                prompt = build_incident_report_prompt(telemetry_text)
                response = granite_model.generate_text(prompt=prompt)
                results = parse_granite_response(response, telemetry_text)
                # Ensure line_number is 1 for the single summary result
                for item in results:
                    item['line_number'] = 1
                logger.info("✅ Granite returned incident report triage result.")
                return jsonify({
                    'success': True,
                    'message': 'Incident report triage complete (IBM Granite)',
                    'results': results
                })
            except Exception as e:
                logger.error(f"❌ watsonx call failed for PDF triage: {e}. Falling back to mock result.")

        results = get_mock_result_for_document()
        return jsonify({
            'success': True,
            'message': 'Incident report triage complete (mock mode — check API connection)',
            'results': results
        })

    else:
        # ---- .txt / .csv: existing line-by-line loop, untouched ----
        if granite_model is not None:
            try:
                lines = [l.strip() for l in telemetry_text.strip().splitlines() if l.strip()]
                results = []
                result_counter = 1
                for i, line in enumerate(lines):
                    logger.info(f"[upload] Sending line {i + 1}/{len(lines)} to IBM Granite...")
                    prompt = build_triage_prompt(line)
                    response = granite_model.generate_text(prompt=prompt)
                    line_results = parse_granite_response(response, line)
                    for item in line_results:
                        item['line_number'] = result_counter
                        result_counter += 1
                    results.extend(line_results)
                    if i < len(lines) - 1:
                        time.sleep(1)
                logger.info(f"✅ Granite returned {len(results)} triage result(s) for uploaded file.")
                return jsonify({
                    'success': True,
                    'message': 'Triage complete (IBM Granite)',
                    'results': results
                })
            except Exception as e:
                logger.error(f"❌ watsonx call failed during upload triage: {e}. Falling back to mock results.")

        results = get_mock_results(telemetry_text)
        return jsonify({
            'success': True,
            'message': 'Triage complete (mock mode — check API connection)',
            'results': results
        })


# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors gracefully."""
    return jsonify({'error': 'Page not found'}), 404


@app.errorhandler(500)
def server_error(error):
    """Handle 500 errors gracefully."""
    return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    debug_mode = os.getenv('FLASK_DEBUG', 'True') == 'True'
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=debug_mode
    )
