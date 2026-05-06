import { SYMPTOMS } from './data.js';

const SYSTEM_PROMPT = `You are a patient education writer. Write in warm, plain language (8th-grade level). Address the patient as "you".

CRITICAL RULES — never break these:
- Never state or imply a diagnosis. Never write "you have endometriosis" or "you have been diagnosed". Always use conditional language: "if endometriosis is found", "should your doctor suspect", "if further tests suggest".
- Never prescribe or recommend specific medications.
- Always frame everything as something to discuss with or confirm with their doctor.

Return ONLY valid JSON with these exact keys:

{
  "patient_summary": "2-3 warm sentences explaining what this score suggests and why further evaluation with a doctor is the right next step. Use language like 'your symptoms may suggest' or 'your results indicate it is worth exploring further'.",
  "top_symptom_guidance": [
    {"symptom": "symptom name", "guidance": "2-3 practical sentences on how to manage or cope with this symptom day-to-day."}
  ],
  "checkup_recommendations": [
    {"symptom": "symptom name", "doctor": "type of specialist (e.g. Gynaecologist, Gastroenterologist)", "checkup": "1-2 sentences on what to ask for and why."}
  ],
  "if_suspected": "2-3 sentences: what next steps could look like if a doctor suspects endometriosis, using conditional language throughout (e.g. 'if your doctor suspects...', 'should further tests confirm...'). Do not state a diagnosis.",
  "if_negative": "2-3 sentences: other conditions that could explain these symptoms and which directions to explore.",
  "questions_to_ask_doctor": ["question 1", "question 2", "question 3", "question 4", "question 5"],
  "closing_note": "2-3 warm sentences: the patient is not alone, the average diagnosis takes 7 years, and advocating for themselves is right."
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
  const { score, cluster, answers } = result;
  const yesSymptoms = SYMPTOMS.filter(s => answers[s.key]);

  // Top 4 by correlation weight — these get the management guidance section
  const top4 = [...yesSymptoms]
    .sort((a, b) => b.corr - a.corr)
    .slice(0, 4);

  const top4List = top4.length
    ? top4.map((s, i) => `  ${i + 1}. ${s.label} (${s.sub})`).join('\n')
    : '  (none reported)';

  const allList = yesSymptoms.length
    ? yesSymptoms.map((s, i) => `  ${i + 1}. ${s.label} (${s.sub})`).join('\n')
    : '  (none reported)';

  return `Patient profile:
- Score: ${score.toFixed(2)} / 11.10
- Cluster: ${cluster.id} (${cluster.name}) — ${cluster.diagnosed_pct}% confirmed diagnosis rate

You MUST fill every key in the JSON schema. Do not leave any field empty or use empty arrays.

Required content per key:
- patient_summary: 2–3 sentences (minimum 50 words)
- top_symptom_guidance: exactly ${top4.length} entries, one for each of the 4 highest-weight symptoms below:
${top4List}
- checkup_recommendations: exactly ${yesSymptoms.length} entries, one for every reported symptom below:
${allList}
- if_suspected: 2–3 sentences (minimum 40 words) using conditional language
- if_negative: 2–3 sentences (minimum 40 words) covering at least 2 alternative conditions
- questions_to_ask_doctor: exactly 5 questions
- closing_note: 2–3 warm sentences (minimum 40 words)

Generate the complete brochure JSON now.`;
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

// ─── Find-a-physician (fictional data) ────────────────────────────────────────
const STREETS = [
  'Oak Street', 'Maple Avenue', 'Church Lane', 'High Street', 'Mill Road',
  'Park Avenue', 'Elm Drive', 'Main Street', 'Victoria Road', 'Queen Street',
  "King's Road", 'Station Road', 'Bridge Street', 'Garden Lane', 'Cherry Tree Lane',
  'Rose Hill', 'Ashford Road', 'Beech Grove', 'Cedar Close', 'Willow Way',
  'Hawthorn Lane', 'Birch Avenue', 'Lavender Close', 'Meadow View', 'Linden Road'
];

const FIRST_NAMES = [
  'Sarah', 'James', 'Emily', 'Michael', 'Olivia', 'William', 'Sophia',
  'David', 'Charlotte', 'Thomas', 'Emma', 'Daniel', 'Grace', 'Henry',
  'Isabella', 'Robert', 'Lily', 'Christopher', 'Alice', 'Edward'
];

const LAST_NAMES = [
  'Mitchell', 'Thompson', 'Anderson', 'Roberts', 'Hughes', 'Walker',
  'Foster', 'Bennett', 'Carter', 'Morgan', 'Wright', 'Cooper', 'Brooks',
  'Reynolds', 'Sullivan', 'Hayes', 'Jenkins', 'Powell', 'Russell', 'Bryant'
];

const PRACTICE_SUFFIX = [
  'Health Centre', 'Medical Practice', 'Wellness Clinic', 'Family Practice',
  'Specialist Centre', 'Care Group', 'Medical Rooms', 'Women’s Health Clinic'
];

const TOPICS_BY_SPECIALIST = {
  gyn: [
    'Endometriosis care', 'Menstrual disorders', 'Hormonal therapy',
    'Fertility consultations', 'Pelvic pain management', 'Minimally invasive surgery',
    'Adenomyosis', 'PCOS', 'Menopause care', 'Contraception counselling'
  ],
  gastro: [
    'IBS management', 'Endoscopy', 'Bowel disorders', 'Coeliac disease',
    'Reflux & GERD', 'Inflammatory bowel disease', 'Bloating & motility',
    'Colonoscopy screening', 'Functional GI disorders'
  ],
  urol: [
    'Urinary tract issues', 'Pelvic floor disorders', 'Interstitial cystitis',
    'Kidney stones', 'Incontinence', 'Bladder pain syndrome'
  ],
  endocri: [
    'Hormonal imbalances', 'Thyroid disorders', 'PCOS management',
    'Adrenal disorders', 'Diabetes care'
  ],
  general: [
    'Family medicine', "Women's health", 'Preventive care',
    'Chronic pain', 'Specialist referrals', 'Health screening'
  ],
  pain: [
    'Chronic pain management', 'Nerve block procedures', 'Multidisciplinary pain care',
    'Pelvic pain clinic', 'Medication review'
  ],
  physio: [
    'Pelvic floor physiotherapy', 'Postural assessment', 'Manual therapy',
    'Core stability', 'Rehabilitation programmes'
  ],
  psych: [
    'Chronic pain coping', 'Anxiety & depression', 'Cognitive behavioural therapy',
    'Health psychology'
  ],
  fertil: [
    'Fertility assessment', 'IVF & assisted reproduction', 'Hormonal workup',
    'Reproductive surgery'
  ]
};

const DEFAULT_TOPICS = ['General consultation', 'Specialist referral', 'Diagnostic workup', 'Follow-up care'];

function topicsFor(specialist) {
  const s = specialist.toLowerCase();
  for (const [key, list] of Object.entries(TOPICS_BY_SPECIALIST)) {
    if (s.includes(key)) return list;
  }
  return DEFAULT_TOPICS;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function pickN(arr, n) {
  const copy = [...arr], out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// ─── OpenStreetMap real-data lookup (London-biased) ────────────────────────────
const OSM_NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSM_OVERPASS  = 'https://overpass-api.de/api/interpreter';
const OSM_RADIUS_M  = 4000;
const LONDON_CENTRE = { lat: 51.5074, lon: -0.1278, display: 'London, UK (default)' };

async function fetchWithTimeout(url, opts = {}, ms = 18000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function geocodePostalCode(postal) {
  const cleaned = postal.replace(/\s+/g, ' ').trim();

  // Attempt 1 — UK postcode lookup
  try {
    const url = `${OSM_NOMINATIM}?postalcode=${encodeURIComponent(cleaned)}&country=gb&format=json&limit=1`;
    const r = await fetchWithTimeout(url, {}, 8000);
    const j = await r.json();
    if (j[0]) return { lat: +j[0].lat, lon: +j[0].lon, display: j[0].display_name };
  } catch (_) {}

  // Attempt 2 — free-text query biased to London
  try {
    const url = `${OSM_NOMINATIM}?q=${encodeURIComponent(cleaned + ', London, UK')}&format=json&limit=1`;
    const r = await fetchWithTimeout(url, {}, 8000);
    const j = await r.json();
    if (j[0]) return { lat: +j[0].lat, lon: +j[0].lon, display: j[0].display_name };
  } catch (_) {}

  return null;
}

async function queryOverpass(lat, lon) {
  const q = `[out:json][timeout:20];
(
  nwr["amenity"~"^(doctors|clinic)$"](around:${OSM_RADIUS_M},${lat},${lon});
  nwr["healthcare"~"^(doctor|clinic|centre|physiotherapist)$"](around:${OSM_RADIUS_M},${lat},${lon});
);
out tags center 80;`;
  const r = await fetchWithTimeout(OSM_OVERPASS, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q)
  }, 25000);
  if (!r.ok) throw new Error('Overpass error ' + r.status);
  return r.json();
}

const SPECIALTY_KEYWORDS = {
  gyn:    ['gynae', 'gynec', 'obstet', 'women', 'maternal'],
  gastro: ['gastro', 'digestive', 'endoscop'],
  urol:   ['urol', 'bladder', 'kidney'],
  endocri:['endocrin', 'hormone', 'thyroid'],
  pain:   ['pain'],
  psych:  ['psych', 'mental'],
  physio: ['physio', 'physical therap'],
  fertil: ['fertil', 'reproduct'],
  general:['general', 'family', 'gp']
};

function specialtyMatchScore(specialist, tags) {
  const s = (specialist || '').toLowerCase();
  const hay = [
    tags['healthcare:speciality'] || '',
    tags['speciality'] || '',
    tags.name || '',
    tags['operator'] || ''
  ].join(' ').toLowerCase();

  for (const [key, words] of Object.entries(SPECIALTY_KEYWORDS)) {
    if (s.includes(key)) {
      for (const w of words) if (hay.includes(w)) return 2;
      // Specialty mentioned in user's specialist name but no match in tags
      return tags.healthcare === 'doctor' || tags.amenity === 'doctors' ? 1 : 0;
    }
  }
  // GP-style fallback: any doctor's office is plausibly relevant
  return tags.healthcare === 'doctor' || tags.amenity === 'doctors' ? 1 : 0;
}

function osmTopics(specialist, tags) {
  const sp = (tags['healthcare:speciality'] || tags['speciality'] || '').trim();
  if (sp) {
    const list = sp.split(/[;,]/).map(x => x.trim()).filter(Boolean).slice(0, 3);
    return list.map(t => t.charAt(0).toUpperCase() + t.slice(1));
  }
  return pickN(topicsFor(specialist), 3);
}

function osmToDoctor(el, specialist) {
  const t = el.tags || {};
  const num = t['addr:housenumber'] || '';
  const street = t['addr:street'] || '';
  const postcode = t['addr:postcode'] || '';
  const city = t['addr:city'] || t['addr:suburb'] || t['addr:town'] || '';
  const addr = [
    [num, street].filter(Boolean).join(' '),
    [postcode, city].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');

  return {
    name:    t.name || t.operator || 'Medical Practice',
    practice: t.amenity === 'clinic' ? 'Clinic'
            : t.healthcare === 'physiotherapist' ? 'Physiotherapy'
            : t.amenity === 'doctors' || t.healthcare === 'doctor' ? 'Medical Practice'
            : t.healthcare === 'centre' ? 'Health Centre'
            : 'Healthcare Provider',
    address: addr || 'Address not listed in OSM',
    topics:  osmTopics(specialist, t),
    phone:   t.phone || t['contact:phone'] || null,
    email:   t.email || t['contact:email'] || null,
    website: t.website || t['contact:website'] || null
  };
}

async function findRealDoctors(specialist, postal) {
  const loc = (await geocodePostalCode(postal)) || LONDON_CENTRE;
  let data;
  try { data = await queryOverpass(loc.lat, loc.lon); }
  catch (_) { return { doctors: [], location: loc.display, error: 'overpass' }; }

  const seen = new Set();
  const ranked = (data.elements || [])
    .filter(el => {
      const name = (el.tags?.name || '').trim();
      if (!name) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(el => ({ el, score: specialtyMatchScore(specialist, el.tags || {}) }))
    .sort((a, b) => b.score - a.score);

  const doctors = ranked.slice(0, 6).map(r => osmToDoctor(r.el, specialist));
  return { doctors, location: loc.display };
}

function generateFakeDoctors(specialist, postalCode) {
  const topics = topicsFor(specialist);
  const out = [];
  const usedKeys = new Set();
  for (let i = 0; i < 6; i++) {
    let first, last, key;
    do {
      first = pick(FIRST_NAMES);
      last  = pick(LAST_NAMES);
      key   = first + last;
    } while (usedKeys.has(key));
    usedKeys.add(key);
    const street     = pick(STREETS);
    const number     = Math.floor(Math.random() * 200) + 1;
    const practice   = `${last} ${pick(PRACTICE_SUFFIX)}`;
    const docTopics  = pickN(topics, 3);
    const phoneArea  = ['020', '0161', '0117', '0131', '0121'][Math.floor(Math.random() * 5)];
    const phoneRest  = `${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`;
    const slug       = last.toLowerCase().replace(/[^a-z]/g, '');
    const email      = `appointments@${slug}-${specialist.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8)}.example`;
    out.push({
      name:    `Dr ${first} ${last}`,
      practice,
      address: `${number} ${street}, ${postalCode.toUpperCase()}`,
      topics:  docTopics,
      phone:   `${phoneArea} ${phoneRest}`,
      email
    });
  }
  return out;
}

function ensureFindModal() {
  let modal = document.getElementById('find-physician-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'find-physician-modal';
  modal.className = 'modal-overlay no-print';
  modal.hidden = true;
  document.body.appendChild(modal);
  return modal;
}

function showFindPhysicianModal(specialist) {
  const modal = ensureFindModal();
  modal.innerHTML = `
    <div class="modal-box find-modal-box">
      <button class="modal-close" id="fp-close" type="button" aria-label="Close">&times;</button>
      <p class="modal-eyebrow">Find a Physician</p>
      <h3 class="modal-title">Near you &middot; ${h(specialist)}</h3>
      <p class="modal-body">Enter your postal code. We query <strong>OpenStreetMap</strong> for real medical practices nearby and rank them by relevance to <em>${h(specialist)}</em>. London-area postcodes give the best coverage; outside that we fall back to demonstration data.</p>
      <div class="modal-input-row">
        <input type="text" id="fp-postal" class="modal-input" placeholder="e.g. SW1A 1AA, EC1A 1BB, NW1 6XE" autocomplete="postal-code">
        <button class="submit-btn" id="fp-search" type="button">Search</button>
      </div>
      <div id="fp-results"></div>
    </div>`;
  modal.hidden = false;
  setTimeout(() => document.getElementById('fp-postal')?.focus(), 30);

  const close = () => { modal.hidden = true; };
  document.getElementById('fp-close').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  const escHandler = e => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  const renderDoctorCard = (d, isReal) => `
    <li class="doctor-card">
      <h4 class="doctor-name">${h(d.name)}</h4>
      <p class="doctor-practice">${h(d.practice)} &middot; ${h(d.address)}</p>
      <p class="doctor-topics">${(d.topics || []).map(t => `<span class="doctor-topic">${h(t)}</span>`).join('')}</p>
      <p class="doctor-contact">
        ${d.phone ? `<span class="doctor-contact-key">Phone</span> ${h(d.phone)}` : `<span class="doctor-contact-missing">Phone not listed</span>`}
        <span class="doctor-contact-sep">&middot;</span>
        ${d.email
          ? `<span class="doctor-contact-key">Email</span> <a href="mailto:${h(d.email)}">${h(d.email)}</a>`
          : isReal && d.website
            ? `<span class="doctor-contact-key">Web</span> <a href="${h(d.website)}" target="_blank" rel="noopener">${h(d.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`
            : `<span class="doctor-contact-missing">Email not listed</span>`}
      </p>
    </li>`;

  const search = async () => {
    const postal = document.getElementById('fp-postal').value.trim();
    if (!postal) {
      document.getElementById('fp-postal').focus();
      return;
    }
    const resultsEl = document.getElementById('fp-results');
    const searchBtn = document.getElementById('fp-search');

    resultsEl.innerHTML = `
      <p class="modal-loading">
        <span class="modal-loading-dot"></span>
        Searching practices near <strong>${h(postal.toUpperCase())}</strong> via OpenStreetMap…
      </p>`;
    searchBtn.disabled = true;

    let osm = null;
    try { osm = await findRealDoctors(specialist, postal); }
    catch (_) { osm = null; }

    searchBtn.disabled = false;

    if (osm && osm.doctors.length >= 3) {
      resultsEl.innerHTML = `
        <p class="modal-section-label">Up to six practices near ${h(osm.location)}</p>
        <ul class="doctor-list">
          ${osm.doctors.map(d => renderDoctorCard(d, true)).join('')}
        </ul>
        <p class="modal-fineprint">
          Live data &middot; &copy; OpenStreetMap contributors (ODbL).
          Some entries may have missing phone or email — this is normal for OSM.
        </p>`;
    } else {
      const fallback = generateFakeDoctors(specialist, postal);
      const reason = osm && osm.error === 'overpass'
        ? 'OpenStreetMap is currently unreachable.'
        : osm && osm.doctors.length === 0
          ? 'No practices were found in OpenStreetMap for this area.'
          : 'Not enough practices were found in OpenStreetMap for this area.';
      resultsEl.innerHTML = `
        <p class="modal-section-label">Six demo practices near ${h(postal.toUpperCase())}</p>
        <ul class="doctor-list">
          ${fallback.map(d => renderDoctorCard(d, false)).join('')}
        </ul>
        <p class="modal-fineprint">
          ${h(reason)} Showing fictional demonstration data instead. Try a Greater London postcode (e.g. <strong>SW1A 1AA</strong>, <strong>EC1A 1BB</strong>, <strong>NW1 6XE</strong>) for live OSM results.
        </p>`;
    }
  };
  document.getElementById('fp-search').addEventListener('click', search);
  document.getElementById('fp-postal').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); search(); }
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
function fallback(text, alt) {
  const t = String(text ?? '').trim();
  return t.length ? text : alt;
}

function renderBrochure(data, date) {
  const preview = document.getElementById('brochure-preview');

  const topGuidanceCards = (data.top_symptom_guidance || []).map(item => `
    <div class="brochure-card">
      <h3 class="brochure-card-title">${h(item.symptom)}</h3>
      <p class="brochure-card-guidance">${h(fallback(item.guidance, 'Discuss management strategies for this symptom with your doctor at your next appointment.'))}</p>
    </div>`).join('');

  // Group checkup recommendations by specialist type
  const byDoctor = {};
  (data.checkup_recommendations || []).forEach(item => {
    const doc = item.doctor || 'General Practitioner';
    if (!byDoctor[doc]) byDoctor[doc] = [];
    byDoctor[doc].push(item);
  });
  const checkupGroups = Object.entries(byDoctor).map(([doctor, items]) => `
    <div class="brochure-checkup-group">
      <div class="brochure-checkup-header">
        <h4 class="brochure-checkup-doctor-title">${h(doctor)}</h4>
        <button class="find-physician-btn no-print" type="button" data-specialist="${h(doctor)}">Find a physician</button>
      </div>
      <ul class="brochure-checkup-symptom-list">
        ${items.map(item => `
          <li class="brochure-checkup-item">
            <span class="brochure-checkup-symptom">${h(item.symptom)}</span>
            <p class="brochure-checkup-text">${h(item.checkup)}</p>
          </li>`).join('')}
      </ul>
    </div>`).join('');

  const patientSummary = h(fallback(data.patient_summary,
    'Your symptoms suggest it is worth speaking with a specialist about endometriosis. The following pages outline what you can do day-to-day and which conversations are worth having with your doctor.'));

  const ifSuspectedText = h(fallback(data.if_suspected || data.if_confirmed,
    'If your doctor suspects endometriosis, they may suggest further tests such as a pelvic exam, ultrasound, or MRI. Treatment options vary widely and should be discussed with a specialist who knows your full history.'));

  const ifNegativeText = h(fallback(data.if_negative || data.if_diagnosis_negative?.intro,
    'If endometriosis is ruled out, your symptoms could still have several explanations — for example irritable bowel syndrome, adenomyosis, or pelvic floor dysfunction. Your doctor can help guide the next step in working out which is most likely.'));

  const closingNote = h(fallback(data.closing_note,
    'Remember: the average path to an endometriosis diagnosis takes around seven years. Trust what you know about your own body, and keep advocating for yourself in every appointment.'));

  const fallbackQuestions = [
    'What would you suggest as the next step in investigating my symptoms?',
    'Are there imaging tests or referrals you would recommend?',
    'Could anything else explain what I am experiencing?',
    'What can I do day-to-day to manage my symptoms?',
    'When should I come back to review how things are going?'
  ];
  const questionsArr = (Array.isArray(data.questions_to_ask_doctor) && data.questions_to_ask_doctor.length)
    ? data.questions_to_ask_doctor
    : fallbackQuestions;
  const questions = questionsArr.map(q => `
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
        <blockquote class="brochure-pullquote">${patientSummary}</blockquote>
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-manage">
        <h3 class="brochure-section-title" id="bs-manage">Managing Your Most Significant Symptoms</h3>
        <p class="brochure-section-intro">The four symptoms below carry the highest clinical weight in your assessment. Here is some practical guidance for each.</p>
        <div class="brochure-cards">${topGuidanceCards}</div>
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-checkups">
        <h3 class="brochure-section-title" id="bs-checkups">Recommended Checkups by Symptom</h3>
        <p class="brochure-section-intro">For each symptom you reported, here is which specialist can help and what to ask about at your next appointment.</p>
        <div class="brochure-checkup-container">${checkupGroups}</div>
      </section>

      ${ornament()}

      <section class="brochure-section" aria-labelledby="bs-confirmed">
        <h3 class="brochure-section-title" id="bs-confirmed">If Endometriosis Is Suspected</h3>
        <p class="brochure-body">${ifSuspectedText}</p>
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
        <p class="brochure-closing">${closingNote}</p>
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
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      ignoreElements: el => el.classList && el.classList.contains('no-print')
    },
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

  // Delegated handler for "Find a physician" buttons inside the brochure preview
  const preview = document.getElementById('brochure-preview');
  if (preview && !preview._findInit) {
    preview._findInit = true;
    preview.addEventListener('click', e => {
      const fb = e.target.closest('.find-physician-btn');
      if (!fb) return;
      e.preventDefault();
      showFindPhysicianModal(fb.dataset.specialist || 'Specialist');
    });
  }
}
