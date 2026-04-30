import { SYMPTOMS } from './data.js';

const SYSTEM_PROMPT = `You are a clinical decision support assistant integrated into an endometriosis symptom assessment tool used by physicians. The tool calculates a cumulative correlation score by summing 25 symptom indicators, each weighted by its literature-derived correlation with a confirmed endometriosis diagnosis. Patients are stratified into 5 quintile clusters (Very Low → Very High) based on a 200-patient reference cohort.

When a patient assessment is provided in context, ground your answers in those specific results. Be concise (2–4 short paragraphs unless asked for depth), cite specific symptom weights when relevant (e.g., "dyspareunia carries a weight of 0.63"), and always include the reminder that this tool provides probabilistic screening only — laparoscopic visualization with histological confirmation remains the diagnostic gold standard for endometriosis.

When asked about differentials, organize your response by symptom system (gynecological, GI, urological). When asked about imaging, prioritize transvaginal ultrasound as first-line and pelvic MRI for suspected deep infiltrating disease. Never give absolute diagnostic certainty.`;

let messageHistory = [];
let assessmentContext = null;
let isOpen = false;
let isStreaming = false;

function getApiKey() {
  return sessionStorage.getItem('anthropic_api_key');
}

function setApiKey(key) {
  sessionStorage.setItem('anthropic_api_key', key.trim());
}

function showApiKeyModal() {
  return new Promise(resolve => {
    const modal = document.getElementById('api-key-modal');
    const input = document.getElementById('api-key-input');
    const btn = document.getElementById('api-key-submit');
    const cancel = document.getElementById('api-key-cancel');

    input.value = '';
    modal.hidden = false;
    input.focus();

    function submit() {
      const key = input.value.trim();
      if (!key) return;
      setApiKey(key);
      modal.hidden = true;
      cleanup();
      resolve(key);
    }

    function cancelFn() {
      modal.hidden = true;
      cleanup();
      resolve(null);
    }

    function onKey(e) {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancelFn();
    }

    btn.addEventListener('click', submit);
    cancel.addEventListener('click', cancelFn);
    input.addEventListener('keydown', onKey);

    function cleanup() {
      btn.removeEventListener('click', submit);
      cancel.removeEventListener('click', cancelFn);
      input.removeEventListener('keydown', onKey);
    }
  });
}

export function injectAssessmentContext(result) {
  const { score, cluster, topFactors, answers } = result;

  const symptomLines = SYMPTOMS.map(s => {
    const val = answers[s.key] ? 'YES' : 'NO';
    return `  ${s.label} (weight ${s.corr}): ${val}`;
  }).join('\n');

  const topStr = topFactors.map((f, i) =>
    `  ${i + 1}. ${f.label} (weight ${f.corr}, contribution ${f.contribution.toFixed(2)})`
  ).join('\n');

  assessmentContext = `PATIENT ASSESSMENT CONTEXT:
Score: ${score.toFixed(2)} / 11.10
Cluster: ${cluster.name} (Cluster ${cluster.id} of 5) — ${cluster.diagnosed_pct}% of patients in this cluster had confirmed endometriosis diagnosis

Symptom Answers:
${symptomLines}

Top 3 Contributing Factors:
${topStr}`;

  // Signal chat launcher to pulse
  document.getElementById('chat-launcher')?.classList.add('pulse');
}

function buildMessages() {
  const msgs = [...messageHistory];
  if (assessmentContext) {
    msgs.unshift({
      role: 'user',
      content: assessmentContext
    });
    msgs.splice(1, 0, {
      role: 'assistant',
      content: 'I have received and reviewed the patient assessment context. I am ready to answer your clinical questions based on these results.'
    });
  }
  return msgs;
}

async function callAnthropicStream(apiKey, onChunk, onDone, onError) {
  const messages = buildMessages();
  let body;
  try {
    body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
      stream: true
    });
  } catch (e) {
    onError('Failed to serialize request.');
    return;
  }

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body
    });
  } catch (e) {
    onError('Connection error — please check your API key or try again.');
    return;
  }

  if (!response.ok) {
    let msg = 'Connection error — please check your API key or try again.';
    try {
      const err = await response.json();
      if (err?.error?.message) msg = err.error.message;
    } catch (_) {}
    onError(msg);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          onChunk(parsed.delta.text);
        }
        if (parsed.type === 'message_stop') {
          onDone();
        }
      } catch (_) {}
    }
  }
  onDone();
}

function appendUserMessage(text) {
  const area = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg--user';
  div.textContent = text;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function appendAssistantMessage() {
  const area = document.getElementById('chat-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-msg chat-msg--assistant';
  const label = document.createElement('span');
  label.className = 'msg-label';
  label.textContent = 'ASSISTANT';
  const body = document.createElement('p');
  body.className = 'msg-body';
  wrapper.appendChild(label);
  wrapper.appendChild(body);
  area.appendChild(wrapper);
  area.scrollTop = area.scrollHeight;
  return body;
}

function appendErrorMessage(text) {
  const area = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg--error';
  div.textContent = text;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function showTypingIndicator() {
  const area = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-typing';
  div.id = 'typing-indicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function hideTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

async function sendMessage(text) {
  if (isStreaming || !text.trim()) return;

  let apiKey = getApiKey();
  if (!apiKey) {
    apiKey = await showApiKeyModal();
    if (!apiKey) return;
  }

  messageHistory.push({ role: 'user', content: text });
  appendUserMessage(text);

  const input = document.getElementById('chat-input');
  input.value = '';
  input.style.height = 'auto';

  isStreaming = true;
  document.getElementById('chat-send').disabled = true;
  showTypingIndicator();

  const bodyEl = appendAssistantMessage();
  let fullText = '';
  let started = false;

  await callAnthropicStream(
    apiKey,
    chunk => {
      if (!started) {
        hideTypingIndicator();
        started = true;
      }
      fullText += chunk;
      bodyEl.textContent = fullText;
      document.getElementById('chat-messages').scrollTop =
        document.getElementById('chat-messages').scrollHeight;
    },
    () => {
      hideTypingIndicator();
      messageHistory.push({ role: 'assistant', content: fullText });
      isStreaming = false;
      document.getElementById('chat-send').disabled = false;
    },
    err => {
      hideTypingIndicator();
      bodyEl.parentElement?.remove();
      appendErrorMessage(err);
      messageHistory.pop(); // remove failed user message
      isStreaming = false;
      document.getElementById('chat-send').disabled = false;
    }
  );
}

export function initChat() {
  const launcher = document.getElementById('chat-launcher');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const changeKey = document.getElementById('change-api-key');
  const chips = document.querySelectorAll('.suggestion-chip');

  // Greeting
  const area = document.getElementById('chat-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-msg chat-msg--assistant';
  const label = document.createElement('span');
  label.className = 'msg-label';
  label.textContent = 'ASSISTANT';
  const body = document.createElement('p');
  body.className = 'msg-body';
  body.textContent = "I'm here to help you interpret this assessment. You can ask me about specific symptoms, the scoring methodology, differential diagnoses, or next steps for this patient.";
  wrapper.appendChild(label);
  wrapper.appendChild(body);
  area.appendChild(wrapper);

  launcher.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('chat-panel--open', isOpen);
    launcher.classList.remove('pulse');
    if (isOpen) input.focus();
  });

  closeBtn.addEventListener('click', () => {
    isOpen = false;
    panel.classList.remove('chat-panel--open');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) {
      isOpen = false;
      panel.classList.remove('chat-panel--open');
    }
  });

  sendBtn.addEventListener('click', () => sendMessage(input.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.prompt;
      input.focus();
      sendMessage(chip.dataset.prompt);
    });
  });

  changeKey.addEventListener('click', async () => {
    sessionStorage.removeItem('anthropic_api_key');
    await showApiKeyModal();
  });
}
