const STORAGE_KEY = 'osteorag-history-v1';
const MAX_MESSAGES = 40;

const chat = document.getElementById('chat');
const form = document.getElementById('form');
const messageEl = document.getElementById('message');
const sendBtn = document.getElementById('send');
const folderFilter = document.getElementById('folderFilter');
const folderChips = document.querySelectorAll('.fchip');
const suggestChips = document.getElementById('suggestChips');
const newChatBtn = document.getElementById('newChat');

const SUGGESTIONS = {
  all: [
    '¿Qué técnicas cervicales se usan en osteopatía?',
    'Resumen de kinesiotape para linfedema',
    'Anatomía de los músculos del suelo pélvico',
    'Principios del abordaje craneosacral',
    'Indicaciones del taping según Kumbrink',
  ],
  escuela: [
    'Técnicas para cervicales: contraindicaciones',
    'Abordaje visceral del hígado',
    'Principios de osteopatía craneosacral',
    'Evaluación osteopática de la pelvis',
    'Disfunción somática cervical C1–C2',
  ],
  libros: [
    'Aplicación de kinesiotape en cuello',
    'Taping estilo Kumbrink para hombro',
    'Anatomía de músculos paravertebrales',
    'Indicaciones y cortes del kinesiotape',
  ],
  tesis: [
    'Kinesiotape y linfedema: hallazgos de tesis',
    'Evidencia de taping en edema postoperatorio',
    'Protocolos de vendaje linfático en tesis',
  ],
};

const WELCOME =
  'Haz una pregunta sobre tu corpus (escuela, libros, tesis). Las respuestas incluyen citas cuando hay coincidencias.';

/** @type {{ role: string, text: string, citations?: any[] }[]} */
let history = [];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Light markdown: newlines preserved via CSS; **bold** supported. */
function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(history.slice(-MAX_MESSAGES)),
    );
  } catch {
    /* quota / private mode */
  }
}

function citationsBlock(citations) {
  if (!citations?.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'citations';
  const label = document.createElement('div');
  label.className = 'citations-label';
  label.textContent = 'Fuentes';
  wrap.appendChild(label);
  for (const c of citations) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.title = c.excerpt || '';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = c.title || 'Documento';
    const meta = document.createElement('span');
    meta.className = 'meta';
    const page = c.page != null ? `p. ${c.page}` : 'p. —';
    meta.textContent = `${c.source_folder || '?'} · ${page}`;
    chip.append(title, meta);
    if (c.excerpt) {
      const ex = document.createElement('span');
      ex.className = 'ex';
      ex.textContent = c.excerpt;
      chip.append(ex);
    }
    wrap.appendChild(chip);
  }
  return wrap;
}

function appendMessageEl(role, text, { citations, loading } = {}) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (loading) {
    el.classList.add('loading');
    el.innerHTML =
      '<span class="typing"><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span> Buscando…</span>';
  } else if (role === 'bot') {
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = renderMarkdown(text);
    el.appendChild(body);
    const chips = citationsBlock(citations);
    if (chips) el.appendChild(chips);
  } else {
    el.textContent = text;
  }
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function renderAll() {
  chat.innerHTML = '';
  if (!history.length) {
    appendMessageEl('system', WELCOME);
    return;
  }
  for (const m of history) {
    if (m.role === 'user') {
      appendMessageEl('user', m.text);
    } else if (m.role === 'bot') {
      appendMessageEl('bot', m.text, { citations: m.citations });
    } else if (m.role === 'error') {
      const el = appendMessageEl('bot', m.text);
      el.classList.add('error');
    } else if (m.role === 'system') {
      appendMessageEl('system', m.text);
    }
  }
}

function setFolder(value) {
  const v = value || 'all';
  folderFilter.value = v;
  folderChips.forEach((btn) => {
    const on = btn.dataset.folder === v;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderSuggestions();
}

function renderSuggestions() {
  const folder = folderFilter.value || 'all';
  const list = SUGGESTIONS[folder] || SUGGESTIONS.all;
  suggestChips.innerHTML = '';
  for (const q of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'schip';
    btn.textContent = q;
    btn.addEventListener('click', () => {
      messageEl.value = q;
      messageEl.focus();
      form.requestSubmit();
    });
    suggestChips.appendChild(btn);
  }
}

function clearChat() {
  history = [];
  saveHistory();
  renderAll();
  messageEl.value = '';
  messageEl.focus();
}

folderChips.forEach((btn) => {
  btn.addEventListener('click', () => setFolder(btn.dataset.folder));
});

folderFilter.addEventListener('change', () => setFolder(folderFilter.value));

newChatBtn.addEventListener('click', clearChat);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = messageEl.value.trim();
  if (!message) return;

  history.push({ role: 'user', text: message });
  if (history.length > MAX_MESSAGES) history = history.slice(-MAX_MESSAGES);
  saveHistory();
  appendMessageEl('user', message);
  messageEl.value = '';
  sendBtn.disabled = true;

  const pending = appendMessageEl('bot', '', { loading: true });

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        folderFilter: folderFilter.value || 'all',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errText =
        data.error || data.detail || `Error HTTP ${res.status}`;
      pending.classList.remove('loading');
      pending.classList.add('error');
      pending.textContent = errText;
      history.push({ role: 'error', text: errText });
      saveHistory();
      return;
    }
    const answer = data.answer || '(sin respuesta)';
    pending.classList.remove('loading');
    pending.innerHTML = '';
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = renderMarkdown(answer);
    pending.appendChild(body);
    const chips = citationsBlock(data.citations);
    if (chips) pending.appendChild(chips);
    history.push({
      role: 'bot',
      text: answer,
      citations: data.citations || [],
    });
    if (history.length > MAX_MESSAGES) history = history.slice(-MAX_MESSAGES);
    saveHistory();
  } catch {
    const errText = 'No se pudo contactar al servidor';
    pending.classList.remove('loading');
    pending.classList.add('error');
    pending.textContent = errText;
    history.push({ role: 'error', text: errText });
    saveHistory();
  } finally {
    sendBtn.disabled = false;
    messageEl.focus();
    chat.scrollTop = chat.scrollHeight;
  }
});

messageEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

messageEl.addEventListener('input', () => {
  messageEl.style.height = 'auto';
  messageEl.style.height = `${Math.min(messageEl.scrollHeight, 140)}px`;
});

history = loadHistory();
setFolder(folderFilter.value || 'all');
renderAll();
