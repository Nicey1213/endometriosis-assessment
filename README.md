# Endometriosis Clinical Assessment Tool

A single-page clinical decision support application for physicians performing endometriosis symptom assessments, with an integrated AI chat assistant powered by the Anthropic API.

## Important Notice

**This is a clinical research tool, not a diagnostic device.** The scores and cluster stratifications produced by this instrument are probabilistic indicators derived from a synthetic 200-patient reference cohort. They are intended to support — not replace — clinical judgment. The diagnostic gold standard for endometriosis remains **laparoscopic visualization with histological confirmation**.

## About the Scoring Model

The instrument calculates a cumulative correlation score by summing 25 symptom indicators, each weighted by its literature-derived Pearson correlation with confirmed endometriosis diagnosis. Scores range from 0 to a theoretical maximum of 11.10, and are stratified into five clusters:

| Cluster | Range | Cohort Diagnosis Rate |
|---------|-------|----------------------|
| Very Low | 0.00 – 1.40 | 14% |
| Low | 1.40 – 2.85 | 32% |
| Moderate | 2.85 – 4.40 | 56% |
| High | 4.40 – 5.95 | 78% |
| Very High | 5.95 – 11.10 | 94% |

The reference cohort of n = 200 patients was a synthetic dataset used to calibrate cluster thresholds. Correlation weights reflect published epidemiological literature on endometriosis symptom prevalence.

## How to Run

No build step required. Open `index.html` directly in any modern browser:

```
open index.html
```

Or serve locally for ES module support (required in some browsers):

```bash
npx serve .
# or
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## AI Chat Assistant

The integrated clinical assistant calls the Anthropic API directly from your browser using your own API key.

### API Key Storage

- Your key is stored in **`sessionStorage` only** — it is cleared automatically when you close the browser tab.
- It is **never** stored in `localStorage`, cookies, or sent to any server other than `api.anthropic.com`.
- To obtain an API key, visit: https://console.anthropic.com/

### What the assistant knows

Once you generate an assessment, the assistant automatically receives (as a hidden system context message):

- All 25 symptom answers (Yes/No)
- The calculated score and cluster
- The top 3 contributing factors

You can then ask follow-up questions about the specific patient's presentation.

## File Structure

```
endometriosis-assessment/
├── index.html       — page markup, form logic, module bootstrap
├── styles.css       — all visual styling (no framework)
├── data.js          — symptom definitions, cluster thresholds, recommendations
├── assessment.js    — scoring logic and result rendering
├── chat.js          — chat panel UI and Anthropic API streaming
└── README.md        — this file
```

## Browser Requirements

Modern browser with ES module support (Chrome 61+, Firefox 60+, Safari 10.1+, Edge 16+). No polyfills or transpilation required.
