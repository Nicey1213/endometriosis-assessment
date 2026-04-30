# Endometriosis Clinical Assessment Tool

A single-page clinical decision support application for physicians performing endometriosis symptom assessments, with an integrated AI-powered patient brochure generator.

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

No build step required. The assessment tool itself runs without any API key. Open `index.html` directly in any modern browser:

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

## Patient Brochure Agent

After an assessment is complete, the doctor can generate a personalized take-home brochure for the patient. Click **"Generate Brochure →"** in Section III of the result panel.

The brochure is created by an AI agent that reviews the patient's specific symptom profile and produces dual-branch guidance — how to manage symptoms if endometriosis is confirmed, and what alternative workups to consider if it is ruled out. The content is written in plain, accessible language suitable for patients, not clinical jargon.

**The brochure is regenerated on each request and may differ between runs.** It is intended as a starting point for the doctor to review and customize before sharing with the patient.

Once generated, the brochure can be:
- **Previewed inline** directly on the page
- **Downloaded as a PDF** (A4 format, suitable for printing)
- **Printed** directly from the browser

### API Key for Brochure Generation

The brochure agent calls the Anthropic API directly from your browser using your own API key.

- Your key is stored in **`sessionStorage` only** — cleared automatically when you close the tab.
- It is **never** stored in `localStorage`, cookies, or sent anywhere except `api.anthropic.com`.
- To obtain an API key, visit: https://console.anthropic.com/

The scoring assessment itself works with **no API key required**.

## File Structure

```
endometriosis-assessment/
├── index.html             — page markup, form logic, module bootstrap
├── styles.css             — all screen styles (no framework)
├── brochure-template.css  — print-only styles for PDF/print output
├── data.js                — symptom definitions, cluster thresholds, recommendations
├── assessment.js          — scoring logic and result rendering
├── brochure.js            — brochure agent, Anthropic API streaming, PDF download
└── README.md              — this file
```

## Browser Requirements

Modern browser with ES module support (Chrome 61+, Firefox 60+, Safari 10.1+, Edge 16+). No polyfills or transpilation required.
