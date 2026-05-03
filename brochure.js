import { SYMPTOMS } from './data.js';

const SYSTEM_PROMPT = `You are a patient education writer. Write in warm, plain language (8th-grade level). Address the patient as "you". Never diagnose or prescribe. Frame everything as things to discuss with their doctor.

Return ONLY valid JSON with these exact keys:

{
  "patient_summary": "2-3 warm sentences summarising what the score and cluster mean for this patient.",
  "symptom_management": [
    {"symptom": "symptom name", "tips": ["tip 1", "tip 2", "tip 3"]}
  ],
  "if_confirmed": "2-3 sentences: practical day-to-day advice if endometriosis is confirmed, specific to the reported symptoms.",
  "if_negative": "2-3 sentences: other conditions that could explain the reported symptoms, and which types of doctor to ask about.",
  "questions_to_ask_doctor": ["question 1", "question 2", "question 3", "question 4", "question 5"],
  "closing_note": "2-3 warm sentences reassuring the patient they are not alone, noting the average 7-year diagnostic delay, and encouraging them to advocate for themselves."
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

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'llama3.2';

// ─── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(result) {
  const { score, cluster, topFactors, answers } = result;
  const yesSymptoms = SYMPTOMS.filter(s => answers[s.key]);
  const no  = SYMPTOMS.filter(s => !answers[s.key]).map(s => s.label);
  const top = topFactors.map(f => `${f.label} (+${f.contribution.toFixed(2)})`).join(', ');

  const numberedSymptoms = yesSymptoms.length
    ? yesSymptoms.map((s, i) => `  ${i + 1}. ${s.label} — ${s.sub}`).join('\n')
    : '  (none reported)';

  return `Patient profile:
- Cumulative score: ${score.toFixed(2)} / 11.10
- Cluster: ${cluster.id} (${cluster.name}) — ${cluster.diagnosed_pct}% confirmed diagnosis rate in reference cohort
- Top contributing factors: ${top || 'None'}
- Reported NO: ${no.join(', ') || 'None'}

Reported YES symptoms (${yesSymptoms.length} total) — you MUST include ALL of these in the symptom_management array, one entry per symptom, in this exact order:
${numberedSymptoms}

RULES:
- symptom_management must have exactly ${yesSymptoms.length} entries, one per symptom listed above.
- Do not omit any symptom. Do not add symptoms not in the list above.
- Each entry needs 3 practical tips written for a patient, not a doctor.
- All other sections (if_diagnosis_confirmed, if_diagnosis_negative, questions_to_ask_doctor, closing_note) must also be fully completed.

Generate the complete patient brochure JSON now.`;
}

// ─── Ollama streaming call ─────────────────────────────────────────────────────
async function streamAPI(prompt, onChunk, onDone, onError) {
  let body;
  try {
    body = JSON.stringify({
      model: OLLAMA_MODEL,
      format: 'json',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt }
      ],
      stream: true,
      options: {
        temperature: 0.4,  // enough creativity without wild variation
        num_predict: 2500, // sufficient for simplified schema
        num_ctx: 4096      // smaller context = faster generation
      }
    });
  } catch { onError('Failed to build request.'); return; }

  let resp;
  try {
    resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    });
  } catch {
    onError('Could not connect to Ollama — make sure it is running (`ollama serve`) and OLLAMA_ORIGINS=* is set.');
    return;
  }

  if (!resp.ok) {
    let msg = `Ollama error ${resp.status} — is the model installed? Run: ollama pull ${OLLAMA_MODEL}`;
    try { const e = await resp.json(); if (e?.error) msg = e.error; } catch (_) {}
    onError(msg); return;
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line);         // Ollama sends NDJSON, not SSE
        if (!p.done) {
          acc += p.message?.content ?? '';
          onChunk(acc);
        } else {
          onDone(acc);
        }
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

  const ifNegativeText = h(data.if_negative || data.if_diagnosis_negative?.intro || '');

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
        <p class="brochure-body">${h(data.if_confirmed || data.if_diagnosis_confirmed?.intro || '')}</p>
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-other">
        <h3 class="brochure-section-title" id="bs-other">If Other Causes Are Found</h3>
        <p class="brochure-body">${ifNegativeText}</p>
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
        await streamAPI(strictPrompt,
          () => {},
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
    prompt,
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
  const btn = document.getElementById('brochure-generate-btn');
  if (!btn || btn._init) return;
  btn._init = true;
  btn.addEventListener('click', () => runGeneration());
}
