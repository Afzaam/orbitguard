"""
OrbitGuard - AI Triage Assistant for Space-Mission Operators
Stage 1: UI Skeleton

A simple Flask web app that helps operators identify suspicious activity
in spacecraft/ground-station telemetry.

IBM Bob is the primary development tool.
"""

from flask import Flask, render_template, request, jsonify
import os
from dotenv import load_dotenv

# Load environment variables from .env file
# (Will contain IBM watsonx API key and other secrets later)
load_dotenv()

# Create Flask app
app = Flask(__name__)

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
    Receive telemetry data and return triage results.
    
    Stage 1: Returns placeholder response.
    Stage 2: Will connect to IBM Granite via watsonx.
    """
    
    # Get the telemetry text from the request
    data = request.get_json()
    telemetry_text = data.get('telemetry', '')
    
    if not telemetry_text:
        return jsonify({'error': 'No telemetry data provided'}), 400
    
    # ========================================================================
    # PLACEHOLDER RESPONSE
    # In Stage 2, this will call IBM Granite via watsonx to analyze the text
    # ========================================================================
    
    # For now, return a simple mock response structure
    # This shows the human operator what the real output will look like
    
    results = [
        {
            'line_number': 1,
            'telemetry': 'SENSOR_TEMP: 45.2°C [NORMAL]',
            'verdict': 'Normal',
            'confidence': 0.99,
            'explanation': 'Temperature within expected operating range for this sensor.',
            'next_step': 'Continue monitoring.'
        },
        {
            'line_number': 2,
            'telemetry': 'COMMAND_RECV: POWER_DOWN from unknown_user at 03:15 UTC',
            'verdict': 'Suspicious',
            'confidence': 0.87,
            'explanation': 'Command received from unrecognized source outside normal ops window.',
            'next_step': 'Verify user identity and authorization level immediately.'
        },
        {
            'line_number': 3,
            'telemetry': 'SIGNAL_STRENGTH: -120 dBm [WEAK]',
            'verdict': 'Normal',
            'confidence': 0.94,
            'explanation': 'Signal strength consistent with current orbital position and solar activity.',
            'next_step': 'Continue monitoring; use redundant antenna if available.'
        }
    ]
    
    return jsonify({
        'success': True,
        'message': 'Triage complete',
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
    # Get debug mode from environment (default: True for development)
    debug_mode = os.getenv('FLASK_DEBUG', 'True') == 'True'
    
    # Start the Flask development server
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=debug_mode
    )
