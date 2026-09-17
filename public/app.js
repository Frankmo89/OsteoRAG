import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';

const STORAGE_KEY = 'osteorag-history-v1';
const CONV_ID_KEY = 'osteorag-conversation-id-v1';
const CONV_LIST_KEY = 'osteorag-conversations-v1';
const MAX_MESSAGES = 40;

const loginGate = document.getElementById('loginGate');
const appMain = document.getElementById('appMain');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginSubmit = document.getElementById('loginSubmit');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');

const chat = document.getElementById('chat');
const form = document.getElementById('form');
const messageEl = document.getElementById('message');
const sendBtn = document.getElementById('send');
const folderFilter = document.getElementById('folderFilter');
const folderChips = document.querySelectorAll('.fchip');
const folderTip = document.getElementById('folderTip');
const suggestChips = document.getElementById('suggestChips');
const newChatBtn = document.getElementById('newChat');
const toggleHistoryBtn = document.getElementById('toggleHistory');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const historyStatus = document.getElementById('historyStatus');

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let supabase = null;
/** @type {string | null} */
let accessToken = null;

const SUGGESTIONS = {
  all: [
    '¿Qué técnicas cervicales se usan en osteopatía?',
    '¿Qué evidencia hay de kinesiotape en linfedema?',
    'Anatomía de los músculos del suelo pélvico',
    'Principios del abordaje craneosacral',
    'Indicaciones del K-Taping según Kumbrink',
  ],
  escuela: [
    'Técnicas para cervicales: contraindicaciones',
    'Abordaje visceral del hígado',
    'Principios de osteopatía craneosacral',
    'Evaluación osteopática de la pelvis',
    'Disfunción somática cervical C1–C2',
  ],
  libros: [
    'Contraindicaciones del VNM / vendaje neuromuscular',
    'Aplicación de kinesiotape en cuello',
    'Taping estilo Kumbrink para hombro',
    'Indicaciones y cortes del kinesiotape',
    'Anatomía de músculos paravertebrales',
  ],
  tesis: [
    'Kinesiotape y linfedema: hallazgos de tesis',
    'Evidencia de taping en edema postoperatorio',
    'Protocolos de vendaje linfático en tesis',
  ],
};

const FOLDER_TIPS = {
  all: 'Corpus completo: escuela, libros y tesis.',
  escuela: 'Apuntes y técnicas de clase (p. ej. cervicales 06_CERVICALES).',
  libros: 'Manuales de KT/VNM y anatomía (OCR de kinesiotaping).',
  tesis: 'Evidencia clínica y linfedema — mejor aquí que en Libros.',
};

const WELCOME_BY_FOLDER = {
  all: 'Haz una pregunta sobre tu corpus (escuela, libros, tesis). Las respuestas incluyen citas cuando hay coincidencias. Material de estudio — no diagnóstico.',
  escuela: 'Escuela: apuntes y técnicas de osteopatía (cervicales, pelvis, visceral…). Estudio — no diagnóstico.',
  libros: 'Libros: kinesiotape, VNM y anatomía. Si buscas evidencia de linfedema, cambia a Tesis. Estudio — no diagnóstico.',
  tesis: 'Tesis: evidencia clínica (p. ej. linfedema y kinesiotape). Estudio — no diagnóstico.',
};

const WELCOME = WELCOME_BY_FOLDER.all;

/** @type {{ role: string, text: string, citations?: any[] }[]} */
let history = [];
/** @type {string | null} */
let conversationId = null;
/** @type {{ id: string, title: string, folder_filter?: string, created_at?: string, updated_at?: string }[]} */
let conversations = [];
let isLoading = false;
let cloudAvailable = true;
let appBooted = false;

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

function updateSendState() {
  const empty = !messageEl.value.trim();
  sendBtn.disabled = empty || isLoading;
}

function loadLocalHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

function saveLocalHistory() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(history.slice(-MAX_MESSAGES)),
    );
  } catch {
    /* quota / private mode */
  }
}

function loadStoredConversationId() {
  try {
    return localStorage.getItem(CONV_ID_KEY) || null;
  } catch {
    return null;
  }
}

function persistConversationId(id) {
  conversationId = id;
  try {
    if (id) localStorage.setItem(CONV_ID_KEY, id);
    else localStorage.removeItem(CONV_ID_KEY);
  } catch {
    /* ignore */
  }
}

function loadCachedConversations() {
  try {
    const raw = localStorage.getItem(CONV_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cacheConversations(list) {
  conversations = list;
  try {
    localStorage.setItem(CONV_LIST_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

function setHistoryStatus(text) {
  if (historyStatus) historyStatus.textContent = text || '';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
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
      '<span class="typing"><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span> Buscando en el corpus…</span>';
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
    const folder = folderFilter?.value || 'all';
    appendMessageEl('system', WELCOME_BY_FOLDER[folder] || WELCOME);
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
  if (folderTip) {
    folderTip.textContent = FOLDER_TIPS[v] || FOLDER_TIPS.all;
  }
  renderSuggestions();
  if (history.length === 0) {
    const last = chat.querySelector('.msg.system');
    if (last) last.textContent = WELCOME_BY_FOLDER[v] || WELCOME;
  }
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
      updateSendState();
      form.requestSubmit();
    });
    suggestChips.appendChild(btn);
  }
}

function renderHistoryList() {
  if (!historyList) return;
  historyList.innerHTML = '';
  if (!conversations.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = cloudAvailable
      ? 'Aún no hay chats en la nube. Envía un mensaje para guardar.'
      : 'Sin conexión a la nube — usando caché local.';
    historyList.appendChild(empty);
    return;
  }
  for (const c of conversations) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '4px';
    wrap.style.width = '100%';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'history-item' + (c.id === conversationId ? ' active' : '');
    btn.style.flex = '1';
    btn.setAttribute('role', 'listitem');

    const mainWrap = document.createElement('div');
    mainWrap.className = 'history-item-main';
    const titleEl = document.createElement('span');
    titleEl.className = 'history-item-title';
    titleEl.textContent = c.title || 'Nueva chat';
    const metaEl = document.createElement('span');
    metaEl.className = 'history-item-meta';
    const folder =
      c.folder_filter && c.folder_filter !== 'all' ? c.folder_filter : '';
    metaEl.textContent = [formatDate(c.updated_at || c.created_at), folder]
      .filter(Boolean)
      .join(' · ');
    mainWrap.append(titleEl, metaEl);
    btn.appendChild(mainWrap);
    btn.addEventListener('click', () => openConversation(c.id));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'history-item-del';
    del.setAttribute('aria-label', 'Eliminar chat');
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    });

    wrap.append(btn, del);
    historyList.appendChild(wrap);
  }
}

async function refreshAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  accessToken = data.session?.access_token || null;
  return accessToken;
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (accessToken) {
    h.Authorization = `Bearer ${accessToken}`;
  }
  return h;
}

async function apiJson(url, options = {}) {
  if (!accessToken) await refreshAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: authHeaders({
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    }),
  });
  if (res.status === 401) {
    // Sesión caducada → pantalla de login
    accessToken = null;
    showLogin('Sesión expirada. Vuelve a iniciar sesión.');
    const data = await res.json().catch(() => ({ error: 'No autorizado' }));
    return { res, data };
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function refreshConversations() {
  try {
    const { res, data } = await apiJson('/api/conversations');
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    cloudAvailable = true;
    cacheConversations(data.conversations || []);
    setHistoryStatus(`${conversations.length} chat(s)`);
    renderHistoryList();
  } catch {
    cloudAvailable = false;
    conversations = loadCachedConversations();
    setHistoryStatus('Sin nube · caché local');
    renderHistoryList();
  }
}

async function ensureConversation(firstUserMessage) {
  if (conversationId) return conversationId;
  const title =
    firstUserMessage.trim().slice(0, 60) || 'Nueva chat';
  const folder = folderFilter.value || 'all';
  try {
    const { res, data } = await apiJson('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, folderFilter: folder }),
    });
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const id = data.conversation?.id;
    if (!id) throw new Error('sin id');
    persistConversationId(id);
    cloudAvailable = true;
    await refreshConversations();
    return id;
  } catch (err) {
    cloudAvailable = false;
    console.warn('No se pudo crear conversación en la nube', err);
    return null;
  }
}

async function saveTurnToCloud(userText, botText, citations) {
  const id = await ensureConversation(userText);
  if (!id) return;
  try {
    const { res, data } = await apiJson(`/api/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: userText },
          {
            role: 'assistant',
            content: botText,
            citations: citations || [],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    await refreshConversations();
  } catch (err) {
    console.warn('No se pudo guardar el turno en la nube', err);
  }
}

async function openConversation(id) {
  if (!id || isLoading) return;
  try {
    setHistoryStatus('Cargando…');
    const { res, data } = await apiJson(`/api/conversations/${id}`);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    persistConversationId(id);
    const msgs = data.messages || [];
    history = msgs.map((m) => {
      if (m.role === 'user') return { role: 'user', text: m.content };
      return {
        role: 'bot',
        text: m.content,
        citations: m.citations || [],
      };
    });
    saveLocalHistory();
    const ff = data.conversation?.folder_filter;
    if (ff) setFolder(ff);
    else setFolder(folderFilter.value || 'all');
    renderAll();
    renderHistoryList();
    setHistoryStatus(`${conversations.length} chat(s)`);
    messageEl.focus();
  } catch (err) {
    setHistoryStatus('Error al abrir');
    console.warn(err);
  }
}

async function deleteConversation(id) {
  if (!id) return;
  if (!confirm('¿Eliminar este chat?')) return;
  try {
    const { res, data } = await apiJson(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (conversationId === id) {
      clearChat(false);
    }
    await refreshConversations();
  } catch (err) {
    alert('No se pudo eliminar el chat');
    console.warn(err);
  }
}

function clearChat(refreshList = true) {
  history = [];
  saveLocalHistory();
  persistConversationId(null);
  renderAll();
  setFolder(folderFilter.value || 'all');
  messageEl.value = '';
  updateSendState();
  messageEl.focus();
  if (refreshList) renderHistoryList();
}

function toggleHistoryPanel() {
  if (!historyPanel || !toggleHistoryBtn) return;
  const open = historyPanel.hasAttribute('hidden');
  if (open) {
    historyPanel.removeAttribute('hidden');
    toggleHistoryBtn.setAttribute('aria-expanded', 'true');
    refreshConversations();
  } else {
    historyPanel.setAttribute('hidden', '');
    toggleHistoryBtn.setAttribute('aria-expanded', 'false');
  }
}

function setLoginError(msg) {
  if (!loginError) return;
  if (msg) {
    loginError.textContent = msg;
    loginError.hidden = false;
  } else {
    loginError.textContent = '';
    loginError.hidden = true;
  }
}

function showLogin(msg) {
  if (appMain) appMain.hidden = true;
  if (loginGate) loginGate.hidden = false;
  if (msg) setLoginError(msg);
  if (loginEmail) loginEmail.focus();
}

function showApp() {
  setLoginError('');
  if (loginGate) loginGate.hidden = true;
  if (appMain) appMain.hidden = false;
}

function wireUiOnce() {
  if (appBooted) return;
  appBooted = true;

  folderChips.forEach((btn) => {
    btn.addEventListener('click', () => setFolder(btn.dataset.folder));
  });

  folderFilter.addEventListener('change', () => setFolder(folderFilter.value));

  newChatBtn.addEventListener('click', () => clearChat(true));
  if (toggleHistoryBtn) {
    toggleHistoryBtn.addEventListener('click', toggleHistoryPanel);
  }
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        if (supabase) await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
      accessToken = null;
      showLogin('');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = messageEl.value.trim();
    if (!message || isLoading) return;

    history.push({ role: 'user', text: message });
    if (history.length > MAX_MESSAGES) history = history.slice(-MAX_MESSAGES);
    saveLocalHistory();
    appendMessageEl('user', message);
    messageEl.value = '';
    messageEl.style.height = 'auto';
    isLoading = true;
    updateSendState();

    const pending = appendMessageEl('bot', '', { loading: true });

    try {
      if (!accessToken) await refreshAccessToken();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message,
          folderFilter: folderFilter.value || 'all',
        }),
      });
      if (res.status === 401) {
        accessToken = null;
        showLogin('Sesión expirada. Vuelve a iniciar sesión.');
        pending.remove();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText =
          data.error || data.detail || `Error HTTP ${res.status}`;
        pending.classList.remove('loading');
        pending.classList.add('error');
        pending.textContent = errText;
        history.push({ role: 'error', text: errText });
        saveLocalHistory();
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
      saveLocalHistory();
      saveTurnToCloud(message, answer, data.citations || []).catch(() => {});
    } catch {
      const errText = 'No se pudo contactar al servidor';
      pending.classList.remove('loading');
      pending.classList.add('error');
      pending.textContent = errText;
      history.push({ role: 'error', text: errText });
      saveLocalHistory();
    } finally {
      isLoading = false;
      updateSendState();
      messageEl.focus();
      chat.scrollTop = chat.scrollHeight;
    }
  });

  messageEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) form.requestSubmit();
    }
  });

  messageEl.addEventListener('input', () => {
    messageEl.style.height = 'auto';
    messageEl.style.height = `${Math.min(messageEl.scrollHeight, 120)}px`;
    updateSendState();
  });
}

async function bootAppAfterAuth() {
  wireUiOnce();
  history = loadLocalHistory();
  conversationId = loadStoredConversationId();
  conversations = loadCachedConversations();
  setFolder(folderFilter.value || 'all');
  renderAll();
  renderHistoryList();
  updateSendState();
  showApp();

  await refreshConversations();
  if (conversationId) {
    try {
      const { res, data } = await apiJson(`/api/conversations/${conversationId}`);
      if (res.ok && data.messages) {
        history = (data.messages || []).map((m) => {
          if (m.role === 'user') return { role: 'user', text: m.content };
          return {
            role: 'bot',
            text: m.content,
            citations: m.citations || [],
          };
        });
        saveLocalHistory();
        const ff = data.conversation?.folder_filter;
        if (ff) setFolder(ff);
        renderAll();
        renderHistoryList();
      } else if (res.status === 404) {
        persistConversationId(null);
      }
    } catch {
      /* keep local */
    }
  }
  messageEl.focus();
}

async function initAuth() {
  showLogin('');
  setLoginError('Cargando…');

  let cfg;
  try {
    const res = await fetch('/api/config');
    cfg = await res.json().catch(() => ({}));
    if (!res.ok || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error(
        cfg.error || 'Falta configuración de Supabase en el Worker',
      );
    }
  } catch (err) {
    setLoginError(
      err instanceof Error
        ? err.message
        : 'No se pudo cargar /api/config',
    );
    return;
  }

  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      storage: localStorage,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.access_token) {
    accessToken = sessionData.session.access_token;
    setLoginError('');
    await bootAppAfterAuth();
  } else {
    setLoginError('');
    showLogin('');
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    accessToken = session?.access_token || null;
    if (event === 'SIGNED_OUT') {
      showLogin('');
    } else if (
      (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
      accessToken &&
      appMain?.hidden
    ) {
      await bootAppAfterAuth();
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supabase) return;
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
      setLoginError('Correo y contraseña obligatorios');
      return;
    }
    loginSubmit.disabled = true;
    setLoginError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setLoginError(
          error.message === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos'
            : error.message,
        );
        return;
      }
      accessToken = data.session?.access_token || null;
      if (!accessToken) {
        setLoginError('No se recibió sesión');
        return;
      }
      loginPassword.value = '';
      await bootAppAfterAuth();
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : 'Error al iniciar sesión',
      );
    } finally {
      loginSubmit.disabled = false;
    }
  });
}

initAuth().catch((err) => {
  console.error(err);
  setLoginError('Error al iniciar la aplicación');
});
