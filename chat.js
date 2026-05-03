const OLLAMA_URL   = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'llama3.2';

const SYSTEM_PROMPT = `You are a concise clinical assistant supporting a physician evaluating a patient for possible endometriosis. You have access to the patient's assessment profile when provided.

Your role:
- Answer questions about endometriosis symptoms, differential diagnosis, investigations, and management
- Reference the patient's specific symptom profile when relevant
- Keep replies brief and clinically precise (2–4 short paragraphs unless the doctor asks for more depth)

Rules:
- Never state a definitive diagnosis — always use conditional language ("may suggest", "could indicate", "consider referral for")
- Never prescribe specific medications by name
- If asked something outside your clinical scope, say so clearly`;

let _messages  = [];
let _context   = null;
let _streaming = false;

export function setChatContext(result) {
  _context = result;
}

function systemContent() {
  if (!_context) return SYSTEM_PROMPT;
  const { score, cluster, positiveCount } = _context;
  return `${SYSTEM_PROMPT}

Current patient assessment on file:
- Score: ${score.toFixed(2)} / 11.10
- Cluster: ${cluster.id}/5 (${cluster.name}) — ${cluster.diagnosed_pct}% cohort diagnosis rate
- Positive symptoms: ${positiveCount} of 25`;
}

function scrollBottom() {
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function appendUserBubble(text) {
  const area = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className   = 'chat-msg chat-msg--user';
  div.textContent = text;
  area.appendChild(div);
  scrollBottom();
}

function appendAssistantBubble() {
  const area    = document.getElementById('chat-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-msg chat-msg--assistant';
  const label   = document.createElement('span');
  label.className   = 'msg-label';
  label.textContent = 'ASSISTANT';
  const body    = document.createElement('p');
  body.className    = 'msg-body';
  wrapper.appendChild(label);
  wrapper.appendChild(body);
  area.appendChild(wrapper);
  scrollBottom();
  return body;
}

function appendError(text) {
  const area = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className   = 'chat-msg chat-msg--error';
  div.textContent = text;
  area.appendChild(div);
  scrollBottom();
}

function showTyping() {
  const area = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = 'chat-typing';
  div.id        = 'chat-typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  area.appendChild(div);
  scrollBottom();
}

function hideTyping() {
  document.getElementById('chat-typing')?.remove();
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || _streaming) return;

  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  input.value        = '';
  input.style.height = 'auto';
  _streaming         = true;
  sendBtn.disabled   = true;

  _messages.push({ role: 'user', content: text });
  appendUserBubble(text);
  showTyping();

  const bodyEl = appendAssistantBubble();
  let acc      = '';
  let started  = false;

  try {
    const resp = await fetch(OLLAMA_URL, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        messages: [{ role: 'system', content: systemContent() }, ..._messages],
        stream:   true,
        options:  { temperature: 0.5, num_predict: 500, num_ctx: 4096 }
      })
    });

    if (!resp.ok) {
      hideTyping();
      bodyEl.parentElement.remove();
      appendError('Ollama returned an error — is the model installed? Run: ollama pull llama3.2');
      _messages.pop();
      return;
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const p = JSON.parse(line);
          if (!p.done) {
            if (!started) { hideTyping(); started = true; }
            acc += p.message?.content ?? '';
            bodyEl.textContent = acc;
            scrollBottom();
          }
        } catch (_) {}
      }
    }

    if (acc) {
      _messages.push({ role: 'assistant', content: acc });
    } else {
      bodyEl.parentElement.remove();
      appendError('No response received. Please try again.');
      _messages.pop();
    }

  } catch {
    hideTyping();
    bodyEl.parentElement.remove();
    appendError('Could not reach Ollama — make sure it is running and OLLAMA_ORIGINS=* is set.');
    _messages.pop();
  } finally {
    _streaming       = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

export function initChat() {
  const launcher = document.getElementById('chat-launcher');
  const panel    = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const sendBtn  = document.getElementById('chat-send');
  const input    = document.getElementById('chat-input');
  const chips    = document.querySelectorAll('.suggestion-chip');

  if (!launcher || launcher._init) return;
  launcher._init = true;

  // Greeting message
  const area    = document.getElementById('chat-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-msg chat-msg--assistant';
  const label   = document.createElement('span');
  label.className   = 'msg-label';
  label.textContent = 'ASSISTANT';
  const body    = document.createElement('p');
  body.className    = 'msg-body';
  body.textContent  = "I'm here to help you interpret this assessment. Ask me about specific symptoms, differential diagnoses, next steps, or anything else relevant to this patient.";
  wrapper.appendChild(label);
  wrapper.appendChild(body);
  area.appendChild(wrapper);

  launcher.addEventListener('click', () => {
    const opening = panel.classList.toggle('chat-panel--open');
    if (opening) input.focus();
  });

  closeBtn.addEventListener('click', () => panel.classList.remove('chat-panel--open'));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') panel.classList.remove('chat-panel--open');
  });

  sendBtn.addEventListener('click', () => sendMessage(input.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input.value); }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  chips.forEach(chip => {
    chip.addEventListener('click', () => sendMessage(chip.dataset.prompt));
  });
}
