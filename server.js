import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

import { createSession, getSession, destroySession } from './lib/sessions.js';
import {
  listFolders,
  listMessages,
  getMessage,
  setFlags,
  deleteMessage,
  verifyImap,
} from './lib/imap.js';
import { sendMail, verifySmtp } from './lib/smtp.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const COOKIE = 'wm_sid';

// --- Auth helpers ----------------------------------------------------------

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12, // 12h
  };
}

function requireAuth(req, res, next) {
  const sid = req.cookies[COOKIE];
  const session = sid && getSession(sid);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.session = session;
  next();
}

// Wrap async route handlers so rejections become clean 500s.
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal error' });
  });

// --- Routes ----------------------------------------------------------------

app.post(
  '/api/login',
  wrap(async (req, res) => {
    const {
      email,
      imapHost,
      imapPort,
      imapSecure,
      imapUser,
      imapPassword,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPassword,
    } = req.body || {};

    if (!email || !imapHost || !smtpHost) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const config = {
      email,
      imap: {
        host: imapHost,
        port: Number(imapPort) || 993,
        secure: imapSecure !== false,
        auth: {
          user: imapUser || email,
          pass: imapPassword,
        },
      },
      smtp: {
        host: smtpHost,
        port: Number(smtpPort) || 465,
        secure: smtpSecure !== false,
        auth: {
          user: smtpUser || email,
          pass: smtpPassword,
        },
      },
    };

    // Validate credentials against both servers before creating a session.
    await verifyImap(config);
    await verifySmtp(config);

    const sid = crypto.randomBytes(32).toString('hex');
    createSession(sid, config);
    res.cookie(COOKIE, sid, cookieOptions());
    res.json({ ok: true, email });
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
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ email: session.email });
  })
);

app.get(
  '/api/folders',
  requireAuth,
  wrap(async (req, res) => {
    res.json({ folders: await listFolders(req.session) });
  })
);

app.get(
  '/api/messages',
  requireAuth,
  wrap(async (req, res) => {
    const folder = req.query.folder || 'INBOX';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 30);
    const search = (req.query.search || '').trim();
    res.json(await listMessages(req.session, { folder, page, pageSize, search }));
  })
);

app.get(
  '/api/message',
  requireAuth,
  wrap(async (req, res) => {
    const folder = req.query.folder || 'INBOX';
    const uid = parseInt(req.query.uid, 10);
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    res.json(await getMessage(req.session, { folder, uid }));
  })
);

app.post(
  '/api/message/flags',
  requireAuth,
  wrap(async (req, res) => {
    const { folder = 'INBOX', uid, add = [], remove = [] } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    await setFlags(req.session, { folder, uid, add, remove });
    res.json({ ok: true });
  })
);

app.post(
  '/api/message/delete',
  requireAuth,
  wrap(async (req, res) => {
    const { folder = 'INBOX', uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    await deleteMessage(req.session, { folder, uid });
    res.json({ ok: true });
  })
);

app.post(
  '/api/send',
  requireAuth,
  wrap(async (req, res) => {
    const { to, cc, bcc, subject, text, html, inReplyTo, references } =
      req.body || {};
    if (!to) return res.status(400).json({ error: 'Recipient required' });
    const info = await sendMail(req.session, {
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

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`📬  Webmail running on http://localhost:${PORT}`);
});
