import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dns from 'dns';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

import { createSession, getSession, destroySession } from './lib/sessions.js';
import { register, login } from './lib/auth.js';
import {
  getUserById,
  upsertAccount,
  getAccount,
  getAccountSecrets,
} from './lib/db.js';
import {
  listFolders,
  listMessages,
  getMessage,
  setFlags,
  deleteMessage,
  verifyImap,
} from './lib/imap.js';
import { resolveResendKey, sendViaResend } from './lib/resend.js';
import { probe } from './lib/diag.js';

dotenv.config();

// Prefer IPv4 when resolving hostnames — Docker/Coolify/VPS containers often
// lack an IPv6 route, and Node trying IPv6 first would stall until timeout.
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const COOKIE = 'wm_sid';
const REGISTRATION_OPEN = process.env.REGISTRATION_OPEN !== 'false';

// --- Helpers ---------------------------------------------------------------

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12,
  };
}

function requireAuth(req, res, next) {
  const sid = req.cookies[COOKIE];
  const session = sid && getSession(sid);
  const user = session && getUserById(session.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

// Load the logged-in user's mail account (with decrypted secrets) for IMAP /
// send calls. 409 tells the client to open the settings screen.
function requireAccount(req, res, next) {
  const acct = getAccountSecrets(req.user.id);
  if (!acct) {
    return res.status(409).json({ error: 'Account email non configurato' });
  }
  req.account = acct;
  next();
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`[${req.method} ${req.path}] ${err.message || err}`);
    res.status(500).json({ error: err.message || 'Internal error' });
  });

// --- Health & config -------------------------------------------------------

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/config', (req, res) => {
  res.json({
    registrationOpen: REGISTRATION_OPEN,
    globalResend: !!process.env.RESEND_API_KEY,
  });
});

// --- App authentication ----------------------------------------------------

function startSession(res, userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  createSession(sid, userId);
  res.cookie(COOKIE, sid, cookieOptions());
}

app.post(
  '/api/register',
  wrap(async (req, res) => {
    if (!REGISTRATION_OPEN) {
      return res.status(403).json({ error: 'Registrazione disabilitata' });
    }
    const { username, password } = req.body || {};
    const user = await register(username, password);
    startSession(res, user.id);
    res.json({ ok: true, username: user.username });
  })
);

app.post(
  '/api/login',
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    const user = await login(username, password);
    startSession(res, user.id);
    res.json({ ok: true, username: user.username });
  })
);

app.post('/api/logout', (req, res) => {
  const sid = req.cookies[COOKIE];
  if (sid) destroySession(sid);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get(
  '/api/session',
  wrap(async (req, res) => {
    const sid = req.cookies[COOKIE];
    const session = sid && getSession(sid);
    const user = session && getUserById(session.userId);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const account = getAccount(user.id);
    const canSend = !!process.env.RESEND_API_KEY || !!(account && account.hasResendKey);
    res.json({
      username: user.username,
      account, // null until configured
      canSend,
    });
  })
);

// --- Mail account settings -------------------------------------------------

app.get(
  '/api/settings',
  requireAuth,
  wrap(async (req, res) => {
    res.json({ account: getAccount(req.user.id) });
  })
);

app.post(
  '/api/settings',
  requireAuth,
  wrap(async (req, res) => {
    const { email, imapHost, imapPort, imapSecure, imapPassword, resendKey } =
      req.body || {};
    if (!email || !imapHost) {
      return res.status(400).json({ error: 'Email e host IMAP sono obbligatori' });
    }

    // Validate IMAP before saving. Reuse an existing stored password when the
    // field is left blank on edit.
    const existing = getAccountSecrets(req.user.id);
    const passToTest =
      imapPassword && imapPassword !== '' ? imapPassword : existing && existing.imap.auth.pass;
    if (!passToTest) {
      return res.status(400).json({ error: 'Password IMAP obbligatoria' });
    }
    await verifyImap({
      imap: {
        host: imapHost,
        port: Number(imapPort) || 993,
        secure: imapSecure !== false,
        auth: { user: email, pass: passToTest },
      },
    });

    const account = upsertAccount(req.user.id, {
      email,
      imapHost,
      imapPort,
      imapSecure: imapSecure !== false,
      imapPassword,
      resendKey,
    });
    res.json({ ok: true, account });
  })
);

// --- Mail (IMAP) -----------------------------------------------------------

app.get(
  '/api/folders',
  requireAuth,
  requireAccount,
  wrap(async (req, res) => {
    res.json({ folders: await listFolders(req.account) });
  })
);

app.get(
  '/api/messages',
  requireAuth,
  requireAccount,
  wrap(async (req, res) => {
    const folder = req.query.folder || 'INBOX';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 30);
    const search = (req.query.search || '').trim();
    res.json(await listMessages(req.account, { folder, page, pageSize, search }));
  })
);

app.get(
  '/api/message',
  requireAuth,
  requireAccount,
  wrap(async (req, res) => {
    const folder = req.query.folder || 'INBOX';
    const uid = parseInt(req.query.uid, 10);
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    res.json(await getMessage(req.account, { folder, uid }));
  })
);

app.post(
  '/api/message/flags',
  requireAuth,
  requireAccount,
  wrap(async (req, res) => {
    const { folder = 'INBOX', uid, add = [], remove = [] } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    await setFlags(req.account, { folder, uid, add, remove });
    res.json({ ok: true });
  })
);

app.post(
  '/api/message/delete',
  requireAuth,
  requireAccount,
  wrap(async (req, res) => {
    const { folder = 'INBOX', uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    await deleteMessage(req.account, { folder, uid });
    res.json({ ok: true });
  })
);

// --- Send (Resend) ---------------------------------------------------------

app.post(
  '/api/send',
  requireAuth,
  requireAccount,
  wrap(async (req, res) => {
    const { to, cc, bcc, subject, text, html, inReplyTo, references } =
      req.body || {};
    if (!to) return res.status(400).json({ error: 'Destinatario obbligatorio' });

    const apiKey = resolveResendKey(req.account.resendKey);
    if (!apiKey) {
      return res.status(400).json({
        error:
          "Invio non configurato: aggiungi una API key Resend nelle impostazioni, oppure imposta RESEND_API_KEY sul server.",
      });
    }

    const info = await sendViaResend({
      apiKey,
      from: req.account.email,
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      inReplyTo,
      references,
    });
    res.json({ ok: true, messageId: info.messageId });
  })
);

// --- Diagnostics -----------------------------------------------------------

app.get(
  '/api/diag',
  requireAuth,
  wrap(async (req, res) => {
    const checks = [];
    if (req.query.imapHost) {
      checks.push(
        probe(req.query.imapHost, Number(req.query.imapPort) || 993).then((r) => ({
          service: 'IMAP',
          ...r,
        }))
      );
    }
    if (!checks.length) {
      return res.status(400).json({ error: 'Nessun host da verificare' });
    }
    res.json({ results: await Promise.all(checks) });
  })
);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`📬  Webmail running on http://${HOST}:${PORT}`);
});
