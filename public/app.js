// ---------------------------------------------------------------------------
// Webmail front-end (multi-tenant): app login → mail settings → mailbox.
// ---------------------------------------------------------------------------

const IMAP_PRESETS = {
  gmail: { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true },
  outlook: { imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true },
  aruba: { imapHost: 'imaps.aruba.it', imapPort: 993, imapSecure: true },
  libero: { imapHost: 'imapmail.libero.it', imapPort: 993, imapSecure: true },
};

const state = {
  username: null,
  account: null,
  canSend: false,
  globalResend: false,
  authMode: 'login',
  folder: 'INBOX',
  folderTitle: 'Posta in arrivo',
  page: 1,
  pageSize: 30,
  total: 0,
  search: '',
  messages: [],
  activeUid: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------------------------------------------------------------------
// API + toast
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401 && !path.endsWith('/session')) {
    showAuth();
    throw new Error('Sessione scaduta');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

function showView(id) {
  ['auth-view', 'settings-view', 'app-view'].forEach((v) =>
    $('#' + v).classList.toggle('hidden', v !== id)
  );
}
const showAuth = () => showView('auth-view');
const showSettings = () => {
  fillSettingsForm();
  showView('settings-view');
};

// ---------------------------------------------------------------------------
// Auth (login / register)
// ---------------------------------------------------------------------------

$('#auth-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.preset');
  if (!btn) return;
  state.authMode = btn.dataset.mode;
  $$('#auth-tabs .preset').forEach((b) => b.classList.toggle('active', b === btn));
  $('#auth-subtitle').textContent =
    state.authMode === 'login' ? 'Accedi al tuo account' : 'Crea un nuovo account';
  $('#auth-btn').querySelector('.btn-label').textContent =
    state.authMode === 'login' ? 'Accedi' : 'Registrati';
  $('#auth-form').password.setAttribute(
    'autocomplete',
    state.authMode === 'login' ? 'current-password' : 'new-password'
  );
});

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = $('#auth-btn');
  const errEl = $('#auth-error');
  errEl.classList.add('hidden');
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const path = state.authMode === 'login' ? '/api/login' : '/api/register';
    const data = await api(path, {
      method: 'POST',
      body: JSON.stringify({
        username: form.username.value.trim(),
        password: form.password.value,
      }),
    });
    state.username = data.username;
    await bootstrapAfterAuth();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
});

async function bootstrapAfterAuth() {
  const s = await api('/api/session');
  state.username = s.username;
  state.account = s.account;
  state.canSend = s.canSend;
  if (!s.account) {
    showSettings();
  } else {
    await enterApp();
  }
}

// ---------------------------------------------------------------------------
// Settings (mail account)
// ---------------------------------------------------------------------------

$('#settings-presets').addEventListener('click', (e) => {
  const btn = e.target.closest('.preset');
  if (!btn) return;
  const p = IMAP_PRESETS[btn.dataset.preset];
  const form = $('#settings-form');
  form.imapHost.value = p.imapHost;
  form.imapPort.value = p.imapPort;
  form.imapSecure.checked = p.imapSecure;
  $$('#settings-presets .preset').forEach((b) => b.classList.toggle('active', b === btn));
});

function fillSettingsForm() {
  const form = $('#settings-form');
  const a = state.account;
  form.email.value = a ? a.email : '';
  form.imapHost.value = a ? a.imapHost : '';
  form.imapPort.value = a ? a.imapPort : 993;
  form.imapSecure.checked = a ? a.imapSecure : true;
  form.imapPassword.value = '';
  form.resendKey.value = '';
  form.smtpHost.value = a ? a.smtpHost : '';
  form.smtpPort.value = a && a.smtpPort ? a.smtpPort : 465;
  form.smtpSecure.checked = a ? a.smtpSecure : true;
  $('#imap-pass-hint').style.display = a ? 'block' : 'none';
  $('#resend-global-note').textContent = state.globalResend
    ? '✅ Il server ha una chiave Resend configurata: usata solo se non imposti un server SMTP.'
    : 'Inserisci una chiave solo se non usi un server SMTP.';
}

// Port 465 → SSL on; 587/25 → STARTTLS (SSL off). Keep the toggle in sync.
$('#settings-form').smtpPort.addEventListener('input', (e) => {
  const p = Number(e.target.value);
  if (p === 465) $('#settings-form').smtpSecure.checked = true;
  else if (p === 587 || p === 25) $('#settings-form').smtpSecure.checked = false;
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = $('#settings-btn');
  const errEl = $('#settings-error');
  errEl.classList.add('hidden');
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        email: form.email.value.trim(),
        imapHost: form.imapHost.value.trim(),
        imapPort: Number(form.imapPort.value),
        imapSecure: form.imapSecure.checked,
        imapPassword: form.imapPassword.value,
        resendKey: form.resendKey.value.trim() || undefined,
        smtpHost: form.smtpHost.value.trim(),
        smtpPort: Number(form.smtpPort.value),
        smtpSecure: form.smtpSecure.checked,
      }),
    });
    state.account = data.account;
    toast('Impostazioni salvate', 'success');
    await bootstrapAfterAuth();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
});

$('#settings-diag-btn').addEventListener('click', async () => {
  const form = $('#settings-form');
  const box = $('#settings-diag');
  const btn = $('#settings-diag-btn');
  if (!form.imapHost.value.trim()) {
    box.className = 'diag-result';
    box.textContent = 'Inserisci prima l’host IMAP.';
    return;
  }
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Verifica in corso…';
  box.className = 'diag-result';
  box.textContent = '';
  try {
    const params = new URLSearchParams({
      imapHost: form.imapHost.value.trim(),
      imapPort: form.imapPort.value || '993',
    });
    const { results } = await api('/api/diag?' + params.toString());
    box.innerHTML = results.map(renderDiag).join('');
  } catch (err) {
    box.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

function renderDiag(r) {
  const ok = r.tcp && r.tcp.ok;
  const icon = ok ? '✅' : '❌';
  const hasV4 = r.dns.ipv4 && r.dns.ipv4.length;
  const hasV6 = r.dns.ipv6 && r.dns.ipv6.length;
  let line;
  if (ok) line = `raggiungibile in ${r.tcp.ms} ms (${escapeHtml(r.tcp.remoteAddress || '')})`;
  else if (r.tcp && r.tcp.error === 'timeout')
    line = 'timeout — porta probabilmente bloccata dal firewall dell’host';
  else line = `errore: ${escapeHtml((r.tcp && r.tcp.error) || 'sconosciuto')}`;
  return `<div class="diag-row ${ok ? 'ok' : 'fail'}">
    <strong>${icon} ${escapeHtml(r.service)} ${escapeHtml(r.host)}:${r.port}</strong>
    <span>${line}</span>
    <span class="diag-dns">DNS: ${hasV4 ? 'IPv4 ✓' : 'IPv4 ✗'}${hasV6 ? ' · IPv6 ✓' : ''}</span>
  </div>`;
}

$('#settings-logout').addEventListener('click', doLogout);
$('#settings-btn-app').addEventListener('click', showSettings);

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function doLogout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}
$('#logout-btn').addEventListener('click', doLogout);

// ---------------------------------------------------------------------------
// App bootstrap (mailbox)
// ---------------------------------------------------------------------------

async function enterApp() {
  showView('app-view');
  $('#user-email').textContent = state.account ? state.account.email : state.username;
  $('#user-email').title = state.account ? state.account.email : state.username;
  if (!state.canSend) {
    toast('Invio non configurato: aggiungi una API key Resend nelle impostazioni.', 'error');
  }
  await loadFolders();
  await loadMessages();
}

const FOLDER_ICONS = {
  inbox: '📥', sent: '📤', drafts: '📝', junk: '⚠️', trash: '🗑️', archive: '🗄️', folder: '📁',
};
const FOLDER_TITLES = {
  inbox: 'Posta in arrivo', sent: 'Inviata', drafts: 'Bozze', junk: 'Spam', trash: 'Cestino', archive: 'Archivio',
};

async function loadFolders() {
  const { folders } = await api('/api/folders');
  const nav = $('#folder-list');
  nav.innerHTML = '';
  for (const f of folders) {
    const btn = document.createElement('button');
    btn.className = 'folder' + (f.path === state.folder ? ' active' : '');
    btn.dataset.path = f.path;
    const displayName = FOLDER_TITLES[f.role] || f.name;
    btn.innerHTML = `<span class="folder-icon">${FOLDER_ICONS[f.role] || '📁'}</span><span class="folder-name">${escapeHtml(displayName)}</span>`;
    btn.addEventListener('click', () => selectFolder(f));
    nav.appendChild(btn);
  }
}

function selectFolder(f) {
  state.folder = f.path;
  state.folderTitle = FOLDER_TITLES[f.role] || f.name;
  state.page = 1;
  state.search = '';
  $('#search-input').value = '';
  $$('.folder').forEach((b) => b.classList.toggle('active', b.dataset.path === f.path));
  clearReader();
  loadMessages();
}

async function loadMessages() {
  $('#folder-title').textContent = state.folderTitle;
  const list = $('#message-list');
  list.innerHTML = '<div class="loading-state">Caricamento…</div>';
  try {
    const params = new URLSearchParams({
      folder: state.folder,
      page: state.page,
      pageSize: state.pageSize,
    });
    if (state.search) params.set('search', state.search);
    const data = await api('/api/messages?' + params.toString());
    state.messages = data.messages;
    state.total = data.total;
    renderMessages();
    renderPager();
  } catch (err) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderMessages() {
  const list = $('#message-list');
  list.innerHTML = '';
  if (!state.messages.length) {
    list.innerHTML = '<div class="empty-state">Nessun messaggio</div>';
    return;
  }
  for (const m of state.messages) {
    const card = document.createElement('div');
    card.className = 'msg-card' + (m.seen ? '' : ' unread') + (m.uid === state.activeUid ? ' active' : '');
    card.dataset.uid = m.uid;
    const badges = [];
    if (m.flagged) badges.push('⭐');
    if (m.answered) badges.push('↩️');
    card.innerHTML = `
      <div class="msg-row">
        <span class="msg-from">${escapeHtml(m.from || m.fromAddress || '(sconosciuto)')}</span>
        <span class="msg-date">${formatDate(m.date)}</span>
      </div>
      <div class="msg-subject">${escapeHtml(m.subject)}</div>
      ${badges.length ? `<div class="msg-badges">${badges.join('')}</div>` : ''}
    `;
    card.addEventListener('click', () => openMessage(m.uid));
    list.appendChild(card);
  }
}

function renderPager() {
  const pager = $('#list-pager');
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.total === 0) {
    pager.innerHTML = '';
    return;
  }
  pager.innerHTML = `
    <button id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>‹ Prec</button>
    <span>${state.page} / ${totalPages} · ${state.total} msg</span>
    <button id="next-page" ${state.page >= totalPages ? 'disabled' : ''}>Succ ›</button>
  `;
  $('#prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; loadMessages(); } });
  $('#next-page').addEventListener('click', () => { if (state.page < totalPages) { state.page++; loadMessages(); } });
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

function clearReader() {
  state.activeUid = null;
  $('#reader').classList.add('hidden');
  $('#reader-empty').classList.remove('hidden');
  $('#reader-pane').classList.remove('mobile-active');
}

async function openMessage(uid) {
  state.activeUid = uid;
  $$('.msg-card').forEach((c) => c.classList.toggle('active', Number(c.dataset.uid) === uid));
  const reader = $('#reader');
  $('#reader-empty').classList.add('hidden');
  reader.classList.remove('hidden');
  $('#reader-pane').classList.add('mobile-active');
  reader.innerHTML = '<div class="loading-state">Caricamento messaggio…</div>';
  try {
    const params = new URLSearchParams({ folder: state.folder, uid });
    const msg = await api('/api/message?' + params.toString());
    renderReader(msg);
    const card = document.querySelector(`.msg-card[data-uid="${uid}"]`);
    if (card) card.classList.remove('unread');
    const listMsg = state.messages.find((m) => m.uid === uid);
    if (listMsg) listMsg.seen = true;
  } catch (err) {
    reader.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderReader(msg) {
  const reader = $('#reader');
  const initial = (msg.from || '?').replace(/[<"'].*/, '').trim().charAt(0).toUpperCase() || '?';
  reader.innerHTML = `
    <button class="btn-ghost mobile-back hidden" id="reader-back">‹ Indietro</button>
    <h1 class="reader-subject">${escapeHtml(msg.subject)}</h1>
    <div class="reader-meta">
      <div class="reader-avatar">${escapeHtml(initial)}</div>
      <div class="reader-meta-text">
        <div class="reader-from">${escapeHtml(msg.from)}</div>
        <div class="reader-to">A: ${escapeHtml(msg.to || '')}</div>
      </div>
      <div class="reader-date">${formatFullDate(msg.date)}</div>
    </div>
    <div class="reader-actions">
      <button class="btn-primary" id="reply-btn">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
        Rispondi
      </button>
      <button class="icon-btn" id="delete-btn" title="Elimina">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    </div>
    <div class="reader-body" id="reader-body"></div>
    ${renderAttachments(msg.attachments)}
  `;
  const body = $('#reader-body');
  if (msg.html) {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin allow-popups';
    body.appendChild(iframe);
    iframe.srcdoc = `<!doctype html><html><head><base target="_blank">
      <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2233;margin:0;padding:0;line-height:1.6;font-size:15px;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#6c5ce7}
      @media (prefers-color-scheme:dark){body{color:#eef0f7;background:transparent}}</style></head><body>${msg.html}</body></html>`;
    iframe.onload = () => {
      try {
        iframe.style.height = Math.min(iframe.contentWindow.document.body.scrollHeight + 24, 4000) + 'px';
      } catch { iframe.style.height = '600px'; }
    };
  } else {
    body.classList.add('reader-text');
    body.textContent = msg.text || '(messaggio vuoto)';
  }
  $('#reply-btn').addEventListener('click', () => openReply(msg));
  $('#delete-btn').addEventListener('click', () => deleteCurrent(msg));
  const back = $('#reader-back');
  if (window.innerWidth <= 1000) back.classList.remove('hidden');
  back.addEventListener('click', clearReader);
}

function renderAttachments(attachments) {
  if (!attachments || !attachments.length) return '';
  const chips = attachments
    .map((a) => {
      const href = a.content ? `data:${a.contentType};base64,${a.content}` : '#';
      return `<a class="attach-chip" href="${href}" download="${escapeHtml(a.filename)}">📎 ${escapeHtml(a.filename)} <span style="color:var(--text-faint)">${formatSize(a.size)}</span></a>`;
    })
    .join('');
  return `<div class="attachments"><h4>Allegati</h4><div class="attach-list">${chips}</div></div>`;
}

async function deleteCurrent(msg) {
  if (!confirm('Spostare questo messaggio nel cestino?')) return;
  try {
    await api('/api/message/delete', {
      method: 'POST',
      body: JSON.stringify({ folder: state.folder, uid: msg.uid }),
    });
    toast('Messaggio eliminato', 'success');
    clearReader();
    loadMessages();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

const composeOverlay = $('#compose-overlay');

function openCompose({ to = '', cc = '', subject = '', body = '', title = 'Nuovo messaggio', inReplyTo = null, references = null } = {}) {
  const form = $('#compose-form');
  form.to.value = to;
  form.cc.value = cc;
  form.subject.value = subject;
  form.body.value = body;
  form.dataset.inReplyTo = inReplyTo || '';
  form.dataset.references = references || '';
  $('#compose-title').textContent = title;
  const errEl = $('#compose-error');
  if (!state.canSend) {
    errEl.textContent = 'Invio non configurato: aggiungi una API key Resend nelle impostazioni.';
    errEl.classList.remove('hidden');
  } else {
    errEl.classList.add('hidden');
  }
  composeOverlay.classList.remove('hidden');
  form.to.focus();
}

function closeCompose() {
  composeOverlay.classList.add('hidden');
}

function openReply(msg) {
  const quoted = (msg.text || '').split('\n').map((l) => '> ' + l).join('\n');
  const subject = /^re:/i.test(msg.subject) ? msg.subject : 'Re: ' + msg.subject;
  openCompose({
    to: extractAddress(msg.from),
    subject,
    body: `\n\n\n--- ${formatFullDate(msg.date)}, ${msg.from} ha scritto: ---\n${quoted}`,
    title: 'Rispondi',
    inReplyTo: msg.messageId,
    references: msg.references ? [].concat(msg.references, msg.messageId).join(' ') : msg.messageId,
  });
}

$('#compose-btn').addEventListener('click', () => openCompose());
$('#compose-close').addEventListener('click', closeCompose);
$('#compose-discard').addEventListener('click', closeCompose);
composeOverlay.addEventListener('click', (e) => {
  if (e.target === composeOverlay) closeCompose();
});

$('#compose-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = $('#send-btn');
  const errEl = $('#compose-error');
  errEl.classList.add('hidden');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({
        to: form.to.value.trim(),
        cc: form.cc.value.trim() || undefined,
        subject: form.subject.value.trim(),
        text: form.body.value,
        inReplyTo: form.dataset.inReplyTo || undefined,
        references: form.dataset.references || undefined,
      }),
    });
    toast('Messaggio inviato', 'success');
    closeCompose();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

// ---------------------------------------------------------------------------
// Search & refresh
// ---------------------------------------------------------------------------

let searchTimer;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value.trim();
  searchTimer = setTimeout(() => {
    state.search = value;
    state.page = 1;
    loadMessages();
  }, 400);
});

$('#refresh-btn').addEventListener('click', () => {
  state.page = 1;
  loadMessages();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function extractAddress(from) {
  const match = String(from || '').match(/<([^>]+)>/);
  return match ? match[1] : String(from || '').trim();
}
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const diff = (now - d) / 86400000;
  if (diff < 7) return d.toLocaleDateString('it-IT', { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' });
}
function formatFullDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async function init() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    state.globalResend = !!cfg.globalResend;
    if (!cfg.registrationOpen) {
      $('#auth-tabs').classList.add('hidden');
    }
  } catch {
    /* ignore */
  }
  try {
    const s = await api('/api/session');
    state.username = s.username;
    state.account = s.account;
    state.canSend = s.canSend;
    if (!s.account) showSettings();
    else await enterApp();
  } catch {
    showAuth();
  }
})();
