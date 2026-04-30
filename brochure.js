import { SYMPTOMS } from './data.js';

const SYSTEM_PROMPT = `You are a patient education content specialist working alongside physicians. Your task is to generate a personalized take-home brochure based on a clinical endometriosis screening assessment.

You will receive:
- The patient's reported symptom profile (25 yes/no answers)
- Their cumulative correlation score (0–11.10)
- Their assigned risk cluster (1=Very Low → 5=Very High)
- The top 3 contributing symptoms

Your output is a structured JSON object representing a patient-facing brochure. The brochure must:

1. Be written in warm, accessible language at roughly an 8th-grade reading level. Avoid medical jargon; when clinical terms are unavoidable, define them parenthetically.

2. Address the patient directly ("you", "your symptoms"), never refer to them in third person.

3. Be tailored to BOTH possible scenarios:
   - If endometriosis is eventually CONFIRMED: how to manage these specific symptoms day-to-day
   - If endometriosis is RULED OUT: what other conditions could explain these specific symptoms, and what checkups to ask their doctor about

4. Be specific to the symptoms the patient actually reported. Do not give generic advice about symptoms they didn't mention. For each symptom-management tip, name the symptom it addresses.

5. For the differential workup section: organize recommended checkups by body system (gynecological, gastrointestinal, urological, musculoskeletal, mental health) and only include systems relevant to the reported symptoms. For each suggested checkup, briefly explain what it looks for in plain language.

6. Always include a closing reassurance that the patient is not alone, that diagnostic delays are common (mention the 7-year average), and that advocating for their symptoms is appropriate.

7. NEVER give a definitive diagnosis. NEVER prescribe medications. Frame everything as "things to discuss with your doctor."

Return ONLY valid JSON matching this schema:

{
  "patient_summary": "A 2-3 sentence personalized summary of what their score and cluster mean, written warmly.",
  "symptom_management": [
    {
      "symptom": "The reported symptom name (patient-friendly)",
      "tips": ["Tip 1", "Tip 2", "Tip 3"]
    }
  ],
  "if_diagnosis_confirmed": {
    "intro": "1-2 sentence intro about living with endometriosis.",
    "key_strategies": ["Strategy 1 (1 sentence)", "Strategy 2", "Strategy 3", "Strategy 4"],
    "lifestyle_notes": "1 paragraph on diet, exercise, sleep relevant to reported symptoms."
  },
  "if_diagnosis_negative": {
    "intro": "1-2 sentence acknowledging the symptoms are still real and worth investigating.",
    "differential_workup": [
      {
        "system": "Body system (e.g. Gastrointestinal)",
        "rationale": "1 sentence on why this system is relevant given their symptoms",
        "suggested_checkups": [
          {"name": "Test/exam name", "purpose": "What it looks for, in plain words"}
        ]
      }
    ]
  },
  "questions_to_ask_doctor": ["Question 1", "Question 2", "Question 3", "Question 4", "Question 5"],
  "closing_note": "2-3 sentence warm closing reaffirming the patient's experience is valid and they deserve answers."
}`;

const STATUS_STEPS = [
  'Reviewing patient profile…',
  'Identifying symptom management strategies…',
  'Compiling differential workup recommendations…',
  'Drafting brochure content…',
  'Formatting document…',
  '✓ Brochure ready'
];

let _lastResult = null;

// ─── API key helpers ───────────────────────────────────────────────────────────
function getKey() { return sessionStorage.getItem('anthropic_api_key'); }
function saveKey(k) { sessionStorage.setItem('anthropic_api_key', k.trim()); }

function ensureModal() {
  if (document.getElementById('api-key-modal')) return;
  const el = document.createElement('div');
  el.className = 'modal-overlay';
  el.id = 'api-key-modal';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'modal-title');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal-box">
      <h2 class="modal-title" id="modal-title">Anthropic API Key</h2>
      <p class="modal-sub">
        Required to generate the patient brochure. Stored in session memory only —
        cleared automatically when you close this tab. Sent only to api.anthropic.com.
      </p>
      <input type="password" id="api-key-input" class="modal-input"
             placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
      <div class="modal-actions">
        <button class="modal-btn" id="api-key-cancel" type="button">Cancel</button>
        <button class="modal-btn modal-btn--primary" id="api-key-submit" type="button">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

function promptForKey() {
  ensureModal();
  return new Promise(resolve => {
    const modal = document.getElementById('api-key-modal');
    const inp   = document.getElementById('api-key-input');
    const ok    = document.getElementById('api-key-submit');
    const cancel= document.getElementById('api-key-cancel');
    inp.value = '';
    modal.hidden = false;
    inp.focus();

    function submit() {
      const k = inp.value.trim();
      if (!k) return;
      saveKey(k);
      modal.hidden = true;
      cleanup();
      resolve(k);
    }
    function dismiss() { modal.hidden = true; cleanup(); resolve(null); }
    function onKey(e) {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') dismiss();
    }
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', dismiss);
    inp.addEventListener('keydown', onKey);
    function cleanup() {
      ok.removeEventListener('click', submit);
      cancel.removeEventListener('click', dismiss);
      inp.removeEventListener('keydown', onKey);
    }
  });
}

// ─── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(result) {
  const { score, cluster, topFactors, answers } = result;
  const yes = SYMPTOMS.filter(s => answers[s.key]).map(s => s.label);
  const no  = SYMPTOMS.filter(s => !answers[s.key]).map(s => s.label);
  const top = topFactors.map(f => `${f.label} (+${f.contribution.toFixed(2)})`).join(', ');
  return `Patient profile:
- Reported symptoms (Yes): ${yes.join(', ') || 'None'}
- Reported symptoms (No): ${no.join(', ') || 'None'}
- Cumulative score: ${score.toFixed(2)}
- Cluster: ${cluster.id} (${cluster.name}) — ${cluster.diagnosed_pct}% of reference cohort had confirmed diagnosis at this level
- Top contributing factors: ${top || 'None'}

Generate the personalized patient brochure as JSON.`;
}

// ─── Anthropic streaming call ──────────────────────────────────────────────────
async function streamAPI(apiKey, prompt, onChunk, onDone, onError) {
  let body;
  try {
    body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user',      content: prompt },
        { role: 'assistant', content: '{' }   // prefill forces JSON-only output
      ],
      stream: true
    });
  } catch { onError('Failed to build request.'); return; }

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body
    });
  } catch { onError('Connection error — please check your API key or try again.'); return; }

  if (!resp.ok) {
    let msg = 'Connection error — please check your API key or try again.';
    try {
      const err = await resp.json();
      if (err?.error?.message) msg = err.error.message;
      if (resp.status === 429) msg = 'Rate limit reached — please wait a moment before retrying.';
    } catch (_) {}
    onError(msg); return;
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = '{';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const p = JSON.parse(raw);
        if (p.type === 'content_block_delta' && p.delta?.text) {
          acc += p.delta.text;
          onChunk(acc);
        }
        if (p.type === 'message_stop') onDone(acc);
      } catch (_) {}
    }
  }
  onDone(acc);
}

// ─── JSON parser with fallback ─────────────────────────────────────────────────
function tryParse(text) {
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch (_) {}
  return null;
}

// ─── HTML escape ───────────────────────────────────────────────────────────────
function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Status log helpers ────────────────────────────────────────────────────────
function buildStatusLog(area) {
  area.innerHTML = STATUS_STEPS.map((s, i) => `
    <div class="status-step${i === 0 ? ' status-step--active' : ''}"
         style="opacity:${i === 0 ? 1 : 0.3};animation-delay:${i * 200}ms">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="status-text">${h(s)}</span>
    </div>`).join('');
}

function setStep(area, idx) {
  area.querySelectorAll('.status-step').forEach((el, i) => {
    el.classList.toggle('status-step--active', i === idx);
    el.classList.toggle('status-step--done',   i <  idx);
    el.style.opacity = i < idx ? '0.55' : i === idx ? '1' : '0.3';
  });
}

// ─── SVG ornament ──────────────────────────────────────────────────────────────
function ornament() {
  return `<div class="brochure-ornament" aria-hidden="true">
    <svg width="140" height="20" viewBox="0 0 140 20" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 10 Q65 1 70 10 Q75 19 130 10"
            stroke="#8b1e1e" stroke-width="1.2" fill="none" opacity="0.4"/>
      <circle cx="70" cy="10" r="2.5" fill="#8b1e1e" opacity="0.5"/>
    </svg>
  </div>`;
}

// ─── Brochure HTML renderer ────────────────────────────────────────────────────
function renderBrochure(data, date) {
  const preview = document.getElementById('brochure-preview');

  const symptomCards = (data.symptom_management || []).map(item => `
    <div class="brochure-card">
      <h3 class="brochure-card-title">${h(item.symptom)}</h3>
      <ul class="brochure-tips">
        ${(item.tips || []).map(t => `<li>${h(t)}</li>`).join('')}
      </ul>
    </div>`).join('');

  const diffSections = (data.if_diagnosis_negative?.differential_workup || []).map(sys => `
    <div class="brochure-diff-block">
      <h4 class="brochure-diff-system">${h(sys.system)}</h4>
      <p class="brochure-diff-rationale">${h(sys.rationale)}</p>
      <table class="brochure-diff-table">
        <thead><tr><th>Checkup</th><th>What it looks for</th></tr></thead>
        <tbody>
          ${(sys.suggested_checkups || []).map(c =>
            `<tr><td><strong>${h(c.name)}</strong></td><td>${h(c.purpose)}</td></tr>`
          ).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const questions = (data.questions_to_ask_doctor || []).map(q => `
    <li class="brochure-question">
      <span class="brochure-checkbox" aria-hidden="true">&#9744;</span>
      <span>${h(q)}</span>
    </li>`).join('');

  preview.innerHTML = `
    <div class="brochure-actions-top no-print">
      <button class="submit-btn" id="dl-pdf" type="button">Download PDF</button>
      <button class="bulk-btn brochure-print-btn" id="do-print" type="button" style="padding:14px 24px">Print</button>
      <button class="brochure-regen" id="do-regen" type="button">Regenerate</button>
    </div>

    <article class="brochure-doc" id="brochure-doc">
      <header class="brochure-doc-header">
        <p class="brochure-eyebrow">Your Health &middot; Take-Home Summary</p>
        <h2 class="brochure-main-title">Understanding Your Symptom Assessment</h2>
        <p class="brochure-prepared">Prepared ${h(date)} &middot; For discussion with your physician</p>
      </header>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-you">
        <h3 class="brochure-section-title" id="bs-you">For You</h3>
        <blockquote class="brochure-pullquote">${h(data.patient_summary || '')}</blockquote>
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-manage">
        <h3 class="brochure-section-title" id="bs-manage">Managing Your Symptoms</h3>
        <div class="brochure-cards">${symptomCards}</div>
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-confirmed">
        <h3 class="brochure-section-title" id="bs-confirmed">If Endometriosis Is Confirmed</h3>
        <p class="brochure-body">${h(data.if_diagnosis_confirmed?.intro || '')}</p>
        <ol class="brochure-strategies">
          ${(data.if_diagnosis_confirmed?.key_strategies || []).map(s => `<li>${h(s)}</li>`).join('')}
        </ol>
        <p class="brochure-body">${h(data.if_diagnosis_confirmed?.lifestyle_notes || '')}</p>
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-other">
        <h3 class="brochure-section-title" id="bs-other">If Other Causes Are Found</h3>
        <p class="brochure-body">${h(data.if_diagnosis_negative?.intro || '')}</p>
        ${diffSections}
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-qs">
        <h3 class="brochure-section-title" id="bs-qs">Questions to Bring to Your Next Appointment</h3>
        <ul class="brochure-questions-list" role="list">${questions}</ul>
      </section>

      ${ornament()}

      <section class="brochure-section brochure-section--closing" aria-labelledby="bs-note">
        <h3 class="brochure-section-title" id="bs-note">A Note for You</h3>
        <p class="brochure-closing">${h(data.closing_note || '')}</p>
      </section>

      <footer class="brochure-doc-footer">
        Generated ${h(date)} &middot; Discuss with your physician &middot; For informational purposes only
      </footer>
    </article>`;

  preview.hidden = false;
  preview.style.opacity = '0';
  preview.style.transform = 'translateY(16px)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    preview.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    preview.style.opacity = '1';
    preview.style.transform = 'translateY(0)';
  }));
  preview.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('dl-pdf').addEventListener('click',  () => downloadPDF(date));
  document.getElementById('do-print').addEventListener('click', () => window.print());
  document.getElementById('do-regen').addEventListener('click', () => runGeneration());
}

// ─── PDF download ──────────────────────────────────────────────────────────────
function downloadPDF(date) {
  const el = document.getElementById('brochure-doc');
  window.html2pdf().set({
    margin:      [20, 18, 20, 18],
    filename:    `endometriosis-brochure-${date}.pdf`,
    image:       { type: 'jpeg', quality: 0.97 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak:   { mode: ['css', 'legacy'], before: '.brochure-section' }
  }).from(el).save();
}

// ─── Error display ─────────────────────────────────────────────────────────────
function showError(area, btn, msg) {
  btn.disabled = false;
  btn.textContent = 'Generate Brochure →';
  const p = document.createElement('p');
  p.className = 'brochure-error';
  p.innerHTML = `${h(msg)} <button class="brochure-retry-btn" type="button">Try again</button>`;
  area.appendChild(p);
  p.querySelector('.brochure-retry-btn').addEventListener('click', () => { p.remove(); runGeneration(); });
}

// ─── Main generation flow ──────────────────────────────────────────────────────
async function runGeneration() {
  const btn    = document.getElementById('brochure-generate-btn');
  const area   = document.getElementById('brochure-status');
  const preview= document.getElementById('brochure-preview');
  if (!btn || !area || !_lastResult) return;

  // Reset state
  if (preview) { preview.hidden = true; preview.innerHTML = ''; }
  btn.disabled = true;
  btn.textContent = 'Generating…';
  area.hidden = false;
  buildStatusLog(area);

  // Timed step advancement (steps 1–4, step 5 fires on completion)
  const delays  = [2200, 5000, 8500, 12000];
  const timers  = delays.map((d, i) => setTimeout(() => setStep(area, i + 1), d));
  const warnT   = setTimeout(() => {
    const w = document.createElement('p');
    w.className = 'status-warning';
    w.textContent = 'This is taking longer than usual — the agent is still working…';
    area.appendChild(w);
  }, 30000);

  const apiKey = getKey();
  const prompt = buildPrompt(_lastResult);
  const date   = new Date().toISOString().slice(0, 10);
  let retried  = false;

  function cleanup() { timers.forEach(clearTimeout); clearTimeout(warnT); }

  async function finish(text) {
    cleanup();
    setStep(area, STATUS_STEPS.length - 1);
    const data = tryParse(text);

    if (!data) {
      if (!retried) {
        retried = true;
        buildStatusLog(area);
        setStep(area, 3);
        const strictPrompt = prompt +
          '\n\nCRITICAL: Output ONLY valid JSON. No markdown fences, no prose, no explanation. Start with { end with }.';
        let acc2 = '{';
        await streamAPI(apiKey, strictPrompt,
          c => { acc2 = c; },
          async t2 => {
            const d2 = tryParse(t2);
            if (!d2) { showError(area, btn, 'Could not parse brochure content. Please regenerate.'); return; }
            btn.disabled = false;
            btn.textContent = 'Generate Brochure →';
            renderBrochure(d2, date);
          },
          err => showError(area, btn, err)
        );
        return;
      }
      showError(area, btn, 'Could not generate brochure. Please try again.');
      return;
    }

    btn.disabled = false;
    btn.textContent = 'Generate Brochure →';
    renderBrochure(data, date);
  }

  await streamAPI(
    apiKey, prompt,
    () => {},           // chunks not used for progress display
    finish,
    err => { cleanup(); showError(area, btn, err); }
  );
}

// ─── Public API ────────────────────────────────────────────────────────────────
export function setBrochureResult(result) {
  _lastResult = result;
  const preview = document.getElementById('brochure-preview');
  if (preview) { preview.hidden = true; preview.innerHTML = ''; }
  const status = document.getElementById('brochure-status');
  if (status) { status.hidden = true; status.innerHTML = ''; }
}

export function initBrochure() {
  ensureModal();
  const btn = document.getElementById('brochure-generate-btn');
  if (!btn || btn._init) return;
  btn._init = true;

  document.getElementById('brochure-change-key')?.addEventListener('click', async () => {
    sessionStorage.removeItem('anthropic_api_key');
    await promptForKey();
  });

  btn.addEventListener('click', async () => {
    let key = getKey();
    if (!key) { key = await promptForKey(); if (!key) return; }
    runGeneration();
  });
}
