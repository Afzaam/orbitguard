# 🛰️ OrbitGuard
### AI-Assisted Telemetry Triage for Space Missions

> **Built for the IBM AI Builders Challenge — Advance Space Exploration with AI**

---

## 📡 What Is OrbitGuard?

OrbitGuard is an AI-powered triage assistant that helps space-mission operators cut through the noise in spacecraft and ground-station telemetry logs — fast. Paste your telemetry, click **Run Triage**, and receive a plain-language breakdown of every line: what looks normal, what looks suspicious, and exactly what to do next.

---

## 🌌 The Problem

Modern space systems — satellites, ground stations, and mission-control networks — are increasingly targeted by sophisticated cyberattacks. The challenge for operators is that **the symptoms of a cyberattack often look identical to an ordinary malfunction**: an unexpected command, an anomalous signal, an off-schedule data packet.

When something goes wrong during a mission, operators may have only minutes to decide whether they're dealing with a hardware glitch or an active intrusion. Getting that call wrong can mean losing a spacecraft.

---

## 🛡️ The Solution

OrbitGuard acts as a **first-pass triage partner** for the human operator. It ingests raw telemetry lines and uses AI to classify each one, delivering:

| Output | Description |
|---|---|
| **Verdict** | `Normal` / `Suspicious` / `Likely Attack` with a confidence score |
| **Explanation** | A plain-language reason — no jargon, no black box |
| **Next Step** | A concrete recommended action for the operator |

OrbitGuard does not make autonomous decisions. It surfaces what matters, explains its reasoning, and keeps the human operator firmly in control.

---

## ✨ Key Features

- 🔍 **Line-by-line telemetry analysis** — every log entry gets its own verdict
- 🧠 **AI-generated explanations** — understand *why* something looks suspicious, not just *that* it does
- ✅ **Actionable next steps** — no ambiguity; each result tells the operator what to do
- 🎨 **Mission-control UI** — deep navy + cyan aesthetic built for clarity under pressure
- ⚡ **Zero setup for operators** — paste logs, click a button, get results
- ♿ **Accessible design** — high-contrast mode, reduced-motion support, large readable fonts
- 🔒 **Secrets-safe** — API keys live in `.env`, never in the browser or repository

---

## 🤖 AI Approach & Architecture

OrbitGuard uses **IBM Granite** (via **IBM watsonx**) as its reasoning engine. Granite was chosen for its strong performance on structured analytical tasks and its alignment with IBM's enterprise-grade AI principles.

The analysis pipeline is intentionally straightforward:

```
[ Operator pastes telemetry logs ]
            │
            ▼
  [ Flask backend receives text ]
            │
            ▼
  [ IBM Granite (via watsonx) analyzes each line ]
  → Classifies: Normal / Suspicious / Likely Attack
  → Generates plain-language explanation
  → Suggests operator next step
            │
            ▼
  [ Results rendered as color-coded verdict cards ]
  🟢 Normal   🟡 Suspicious   🔴 Likely Attack
```

The prompt is structured to keep Granite grounded in the telemetry context — it is given the telemetry line, the mission context, and asked to reason step by step before delivering a verdict. This reduces hallucination and keeps explanations factual.

**IBM Docling** is integrated in the pipeline to handle uploaded log files, converting `.txt`, `.csv`, `.pdf`, and other formats into structured telemetry that feeds directly into the analysis.

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3, Flask |
| **AI Model** | IBM Granite (via IBM watsonx) |
| **AI Platform** | IBM watsonx.ai |
| **Document Parsing** | IBM Docling |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Config** | python-dotenv |

---

## 🤝 How IBM Bob Was Used

IBM Bob (the AI coding assistant embedded in VS Code) was the **primary development tool** for this entire project. Bob was used to:

- **Plan the architecture** — breaking the project into stages and mapping out the Flask routes, frontend structure, and AI integration approach before a single line of code was written
- **Scaffold the codebase** — generating the initial `app.py`, `index.html`, `style.css`, and `script.js` files with full comments and structure
- **Iterate on the UI** — refining the mission-control aesthetic, color scheme, and component layout through conversation
- **Write this README** — the full documentation was drafted collaboratively with Bob based on the actual project files

Bob acted as a knowledgeable co-developer throughout — not just an autocomplete tool, but a planning partner that understood the project goals and helped make deliberate technical decisions.

---

## 📸 Screenshots

> *(Add your screenshot here — drag an image into this section or paste a relative path below)*

```
![OrbitGuard UI](static/screenshot.png)
```

---

## 🚀 Setup & How to Run

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd OrbitGuard
```

### 2. Create a virtual environment and install dependencies

```bash
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
copy .env.example .env       # Windows
# cp .env.example .env       # macOS / Linux
```

Open `.env` and fill in your IBM watsonx credentials:

```env
WATSONX_API_KEY=your-api-key-here
WATSONX_PROJECT_ID=your-project-id-here
WATSONX_URL=https://api.us-south.ml.cloud.ibm.com
```

### 4. Run the app

```bash
python app.py
```

### 5. Open in your browser

Navigate to **http://127.0.0.1:5000**, paste some telemetry, and click **Run Triage**.

**Sample telemetry to try:**
```
SENSOR_TEMP: 45.2°C [NORMAL]
COMMAND_RECV: POWER_DOWN from unknown_user at 03:15 UTC
SIGNAL_STRENGTH: -120 dBm [WEAK]
```

---

## 🔭 Future Work

- **Real satellite data integration** — connect OrbitGuard to live telemetry streams from publicly available satellite feeds (e.g., NORAD, NASA Open Data)
- **Live ground-station feeds** — real-time WebSocket ingestion from ground-station software, enabling continuous background triage rather than manual paste-and-run
- **Mission profile context** — allow operators to specify the spacecraft type, mission phase, and known anomaly baselines so the AI can reason with mission-specific knowledge
- **Audit trail** — persistent logging of every triage session so operators can review decisions and retrain the model on confirmed incidents
- **Multi-language support** — internationalization for international mission-control teams

---

## 📁 Project Structure

```
OrbitGuard/
├── app.py                 # Flask backend — routes and watsonx integration
├── requirements.txt       # Python dependencies
├── .env.example           # Environment variable template
├── .gitignore             # Keeps secrets out of version control
├── README.md              # This file
├── templates/
│   └── index.html         # Main UI
└── static/
    ├── style.css          # Mission-control styling (deep navy + cyan)
    └── script.js          # Frontend logic (form, AJAX, result cards)
```

---

*OrbitGuard — Built with ❤️ and IBM Bob | IBM AI Builders Challenge 2026*
