# OrbitGuard 🛰️
## AI-Assisted Telemetry Triage for Space Missions

**Stage 1: UI Skeleton** – Building the interface first, AI logic to follow.

---

## What Is OrbitGuard?

OrbitGuard is an **AI triage assistant** for space-mission operators. You paste spacecraft or ground-station telemetry lines, click "Run Triage," and OrbitGuard flags entries that could signal a **cyberattack** (unexpected commands, signal spoofing, strange access times, out-of-sequence data) and separates them from ordinary glitches.

For each line, it provides:
1. **Verdict** – Normal / Suspicious / Likely Attack (with confidence level)
2. **Explanation** – Why it looks that way in plain language
3. **Next Step** – Recommended action for the human operator

**Critical:** OrbitGuard is a **triage assistant**, not an autonomous detector. The human operator makes the final call—this tool helps you understand what matters faster.

---

## Project Structure

```
OrbitGuard/
├── app.py                 # Flask web server (main backend)
├── requirements.txt       # Python dependencies
├── .env.example           # Template for environment variables
├── .gitignore             # Git ignore rules (protects .env)
├── README.md              # This file
├── templates/
│   └── index.html         # Main UI (HTML skeleton)
└── static/
    ├── style.css          # Mission-control styling (deep navy + cyan)
    └── script.js          # Frontend logic (form, AJAX, results)
```

---

## Quick Start

### 1. Install Python Dependencies

```bash
# Navigate to the OrbitGuard folder
cd "path\to\IBM Bob\August Challenge\OrbitGuard"

# Create a virtual environment (optional but recommended)
python -m venv venv
venv\Scripts\activate

# Install Flask and dependencies
pip install -r requirements.txt
```

### 2. Create Your `.env` File

Copy `.env.example` to `.env`:

```bash
copy .env.example .env
```

Edit `.env` with your settings (for now, just keep the defaults):

```
FLASK_DEBUG=True
FLASK_ENV=development
```

### 3. Run the Flask App

```bash
python app.py
```

You should see:
```
 * Running on http://127.0.0.1:5000
 * Debug mode: on
```

### 4. Open in Your Browser

Visit: **http://127.0.0.1:5000**

You'll see the OrbitGuard UI with:
- A mission-control aesthetic (deep navy background, cyan accents)
- A telemetry input box
- A "Run Triage" button
- An info section explaining how it works

### 5. Try It Out

Paste some sample telemetry in the text box:

```
SENSOR_TEMP: 45.2°C [NORMAL]
COMMAND_RECV: POWER_DOWN from unknown_user at 03:15 UTC
SIGNAL_STRENGTH: -120 dBm [WEAK]
```

Click **"Run Triage"** → You'll see placeholder results showing what the real output will look like.

---

## Design Principles

### Aesthetic
- **Deep space-navy background** (#0a0e27, #1a1f3a) – calm and trustworthy
- **Cyber cyan/teal accents** (#00d9ff, #00f0ff) – signals security and tech
- **Clean, uncluttered layout** – easy to scan
- **High contrast** – readable for all audiences

### Interaction
- Simple, large buttons
- Clear visual feedback (loading spinner, color-coded verdicts)
- Monospace font for telemetry (shows it's technical data)
- Color-coded result cards:
  - 🟢 **Green** = Normal
  - 🟡 **Orange/Yellow** = Suspicious
  - 🔴 **Red** = Likely Attack

### Accessibility
- Supports high-contrast mode
- Respects `prefers-reduced-motion` (no animations if user prefers)
- Large, readable fonts
- Good color contrast

---

## How It Works (Now & Later)

### Stage 1: UI Skeleton ✅ (You Are Here)
- HTML form for telemetry input
- Mock response endpoint (returns sample results)
- Mission-control UI
- Ready to connect to AI in the next stage

### Stage 2: AI Integration (Next)
- Connect to **IBM Granite** via **IBM watsonx**
- Backend receives telemetry → calls watsonx API → returns real analysis
- Secret API key stored in `.env` (never in browser)

### Stage 3: File Upload (Future)
- Use **IBM Docling** to parse uploaded log files
- Convert various formats (.txt, .csv, .pdf, etc.) into structured telemetry
- Feed into the AI pipeline

---

## File Reference

### `app.py`
The Flask web server. Handles:
- Route `/` – serves the main UI
- Route `/api/triage` (POST) – receives telemetry, returns triage results
  - Stage 1: Returns mock/placeholder results
  - Stage 2: Will call IBM Granite via watsonx

**Key things to update in Stage 2:**
1. Import watsonx SDK
2. Replace the mock results with actual API calls
3. Parse the response and format for the frontend

### `templates/index.html`
The main UI page (HTML skeleton). Includes:
- Header with OrbitGuard logo and tagline
- Input section with a textarea for telemetry
- "Run Triage" and "Clear" buttons
- Loading indicator (spinner)
- Error alert
- Results section (populated by JavaScript)
- Info cards explaining how OrbitGuard works
- Footer

### `static/style.css`
Mission-control styling. Covers:
- Color scheme (deep navy + cyan)
- Typography (clean, readable)
- Component styles (buttons, cards, forms)
- Responsive design (mobile-friendly)
- Accessibility features (high contrast, reduced motion)

### `static/script.js`
Frontend logic. Handles:
- Form submission (listens to "Run Triage" click)
- AJAX request to `/api/triage` endpoint
- Display of results (creates result cards dynamically)
- Error handling and display
- HTML escaping (prevents XSS attacks)

### `.env.example`
Template for environment variables. Copy to `.env` and fill in your secrets.

### `.gitignore`
Protects sensitive files (`.env`, `__pycache__`, etc.) from being committed.

### `requirements.txt`
Python dependencies:
- `Flask` – web framework
- `python-dotenv` – loads `.env` variables

---

## Next Steps (Stage 2: AI Integration)

1. **Set up IBM watsonx account** and get API credentials
2. **Add credentials to `.env`**:
   ```
   WATSONX_API_KEY=xxx
   WATSONX_PROJECT_ID=yyy
   WATSONX_URL=https://...
   ```
3. **Install watsonx SDK** in `requirements.txt`
4. **Update `app.py`** to call watsonx API instead of returning mock results
5. **Test end-to-end** with real telemetry

---

## Common Issues & Fixes

### "ModuleNotFoundError: No module named 'flask'"
- Make sure you've installed dependencies: `pip install -r requirements.txt`
- Make sure your virtual environment is activated

### "Address already in use" on port 5000
- Another app is using port 5000
- Change the port in `app.py`: `app.run(..., port=5001, ...)`
- Or kill the existing process using port 5000

### UI looks broken
- Clear your browser cache (Ctrl+Shift+Delete)
- Hard refresh (Ctrl+Shift+R)
- Make sure static files are loading (check browser console for 404 errors)

### `.env` variables not loading
- Make sure you've renamed `.env.example` to `.env` (not `.env.txt`)
- Restart the Flask server after editing `.env`

---

## Code Comments & Learning

Every file is heavily commented in plain English for beginners. If you want to understand a section:
1. Find the comment with `===` borders (section header)
2. Read the comments above the code
3. The code itself is simple and straightforward

---

## Design Notes for Judges / Non-Experts

OrbitGuard's goal is to help **human operators spot and understand suspicious activity faster**, not to make autonomous security decisions. Each analysis includes:
- **Why** it looks suspicious (plain-language explanation)
- **What confidence** the AI has in that assessment
- **What action** the operator should take next

This keeps the human in control and ensures accountability.

---

## About This Project

- **Entry:** IBM AI Builders Challenge – "Advance Space Exploration with AI" (August 2026)
- **Developer:** A beginner learning AI, Python, and web development
- **Primary Tool:** IBM Bob (VS Code Copilot)
- **Stack:** Python Flask + HTML/CSS/JavaScript
- **Stage 1 Goal:** Build a clean, trustworthy UI that's ready for AI integration

---

## Questions?

If you run into trouble:
1. Check the comments in each file
2. Read the "Common Issues" section above
3. Test by pasting sample telemetry and watching the mock results
4. Review the Stage 2 notes when you're ready to add AI

Good luck with your space mission! 🚀

---

*OrbitGuard v1.0 | Built with ❤️ and IBM Bob*
