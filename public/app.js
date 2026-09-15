const chat = document.getElementById('chat');
const form = document.getElementById('form');
const messageEl = document.getElementById('message');
const sendBtn = document.getElementById('send');
const folderFilter = document.getElementById('folderFilter');

function addMsg(role, text, extra) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  if (extra) el.appendChild(extra);
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function citationsBlock(citations) {
  if (!citations?.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'citations';
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

addMsg(
  'system',
  'Haz una pregunta sobre tu corpus (escuela, libros, tesis). Las respuestas incluyen citas cuando hay coincidencias.',
);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = messageEl.value.trim();
  if (!message) return;

  addMsg('user', message);
  messageEl.value = '';
  sendBtn.disabled = true;

  const pending = addMsg('bot', 'Buscando en el corpus…');

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
      pending.classList.add('error');
      pending.textContent =
        data.error || data.detail || `Error HTTP ${res.status}`;
      return;
    }
    pending.textContent = data.answer || '(sin respuesta)';
    const chips = citationsBlock(data.citations);
    if (chips) pending.appendChild(chips);
  } catch (err) {
    pending.classList.add('error');
    pending.textContent = 'No se pudo contactar con la API. ¿Está wrangler en marcha?';
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
