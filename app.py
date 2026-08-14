"""
OrbitGuard - AI Triage Assistant for Space-Mission Operators
Stage 2: IBM Granite via watsonx integration

HOW THE WATSONX CONNECTION WORKS (for demo explanation):
---------------------------------------------------------
1. When Flask starts, we read three credentials from the .env file:
     - WATSONX_API_KEY   : your IBM Cloud API key (authenticates you)
     - WATSONX_PROJECT_ID: the watsonx project that owns your usage quota
     - WATSONX_URL       : the regional endpoint (e.g. us-south)

2. We create a ModelInference client pointing at "ibm/granite-13b-chat-v2".
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
GRANITE_MODEL_ID = 'ibm/granite-13b-chat-v2'

# Try to create the watsonx client. If credentials are missing or the SDK
# isn't installed yet, granite_model will be None and we fall back to mocks.
granite_model = None
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
# PROMPT BUILDER
# ============================================================================

def build_triage_prompt(telemetry_text: str) -> str:
    """
    Build the structured prompt sent to IBM Granite.

    We give Granite a clear role (space-mission cybersecurity expert),
    a strict output format (JSON array), and the actual telemetry lines
    to analyse. Asking for JSON makes parsing the response reliable.
    """
    lines = [l.strip() for l in telemetry_text.strip().splitlines() if l.strip()]
    numbered_lines = "\n".join(f"{i+1}. {line}" for i, line in enumerate(lines))

    prompt = f"""You are an expert space-mission cybersecurity analyst. Your job is to triage spacecraft and ground-station telemetry logs and identify signs of cyberattack versus normal operation or hardware malfunction.

For each telemetry line below, analyse it and respond with a JSON array. Each item in the array must have exactly these fields:
- "line_number": integer (1-based)
- "telemetry": the original log line (copy it exactly)
- "verdict": one of "Normal", "Suspicious", or "Likely Attack"
- "confidence": a float between 0.0 and 1.0
- "explanation": a plain-English sentence (max 2 sentences) explaining why
- "next_step": a concrete action the human operator should take next

Respond with ONLY the JSON array. Do not include any preamble, commentary, or markdown — just the raw JSON array starting with [ and ending with ].

Telemetry lines to analyse:
{numbered_lines}

JSON response:
"""
    return prompt


# ============================================================================
# RESPONSE PARSER
# ============================================================================

def parse_granite_response(raw_response: str, telemetry_text: str) -> list:
    """
    Extract and validate the JSON array from Granite's response text.

    Granite sometimes wraps JSON in markdown fences or adds a short preamble.
    We strip those out before parsing, then validate that each result has the
    fields the frontend expects.
    """
    # Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    cleaned = re.sub(r'```(?:json)?\s*', '', raw_response).strip()

    # Find the first [ ... ] block in the response
    match = re.search(r'\[.*\]', cleaned, re.DOTALL)
    if not match:
        raise ValueError("No JSON array found in Granite response")

    results = json.loads(match.group(0))

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
# MOCK FALLBACK
# Returns safe placeholder results if the watsonx call fails.
# ============================================================================

def get_mock_results(telemetry_text: str) -> list:
    """
    Return per-line mock results based on the actual pasted lines.
    Used as a fallback when the watsonx API call fails.
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
    # ------------------------------------------------------------------
    if granite_model is not None:
        try:
            prompt = build_triage_prompt(telemetry_text)
            logger.info("Sending telemetry to IBM Granite for analysis...")

            response = granite_model.generate_text(prompt=prompt)

            results = parse_granite_response(response, telemetry_text)
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
