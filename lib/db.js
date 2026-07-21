import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { encrypt, decrypt } from './crypto.js';

// SQLite-backed store for multi-tenant users and their mail account config.
// Uses Node's built-in node:sqlite (no native dependency).

const DATA_DIR = process.env.DATA_DIR || './data';
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'webmail.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    created_at     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS accounts (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email              TEXT NOT NULL,
    imap_host          TEXT NOT NULL,
    imap_port          INTEGER NOT NULL DEFAULT 993,
    imap_secure        INTEGER NOT NULL DEFAULT 1,
    imap_password_enc  TEXT NOT NULL,
    resend_key_enc     TEXT,
    updated_at         INTEGER NOT NULL
  );
`);

// ---- Users ----------------------------------------------------------------

export function createUser(username, passwordHash) {
  const stmt = db.prepare(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
  );
  const info = stmt.run(username, passwordHash, Date.now());
  return { id: Number(info.lastInsertRowid), username };
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

// ---- Mail account (one per user) ------------------------------------------

export function upsertAccount(userId, { email, imapHost, imapPort, imapSecure, imapPassword, resendKey }) {
  const existing = getAccountRow(userId);
  // Keep the old secret if the form left the field blank (unchanged).
  const imapPassEnc =
    imapPassword != null && imapPassword !== ''
      ? encrypt(imapPassword)
      : existing
      ? existing.imap_password_enc
      : null;
  const resendEnc =
    resendKey != null && resendKey !== ''
      ? encrypt(resendKey)
      : resendKey === ''
      ? null // explicit clear
      : existing
      ? existing.resend_key_enc
      : null;

  if (!imapPassEnc) throw new Error('Password IMAP obbligatoria');

  db.prepare(
    `INSERT INTO accounts (user_id, email, imap_host, imap_port, imap_secure, imap_password_enc, resend_key_enc, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email=excluded.email,
       imap_host=excluded.imap_host,
       imap_port=excluded.imap_port,
       imap_secure=excluded.imap_secure,
       imap_password_enc=excluded.imap_password_enc,
       resend_key_enc=excluded.resend_key_enc,
       updated_at=excluded.updated_at`
  ).run(
    userId,
    email,
    imapHost,
    Number(imapPort) || 993,
    imapSecure ? 1 : 0,
    imapPassEnc,
    resendEnc,
    Date.now()
  );
  return getAccount(userId);
}

function getAccountRow(userId) {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ?').get(userId) || null;
}

// Public, non-secret view of the account (for the settings form / status).
export function getAccount(userId) {
  const r = getAccountRow(userId);
  if (!r) return null;
  return {
    email: r.email,
    imapHost: r.imap_host,
    imapPort: r.imap_port,
    imapSecure: !!r.imap_secure,
    hasResendKey: !!r.resend_key_enc,
    updatedAt: r.updated_at,
  };
}

// Full config with decrypted secrets — for making IMAP/Resend calls.
export function getAccountSecrets(userId) {
  const r = getAccountRow(userId);
  if (!r) return null;
  return {
    email: r.email,
    imap: {
      host: r.imap_host,
      port: r.imap_port,
      secure: !!r.imap_secure,
      auth: { user: r.email, pass: decrypt(r.imap_password_enc) },
    },
    resendKey: r.resend_key_enc ? decrypt(r.resend_key_enc) : null,
  };
}

export { db };
