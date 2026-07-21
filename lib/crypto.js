import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// AES-256-GCM encryption for secrets at rest (IMAP passwords, Resend keys).
// The key comes from ENCRYPTION_KEY; if unset, a random key is generated once
// and persisted under DATA_DIR so restarts can still decrypt existing rows.

function loadKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && raw.trim()) {
    // Accept base64/hex 32-byte keys, or hash any passphrase to 32 bytes.
    const t = raw.trim();
    if (/^[A-Fa-f0-9]{64}$/.test(t)) return Buffer.from(t, 'hex');
    try {
      const b = Buffer.from(t, 'base64');
      if (b.length === 32) return b;
    } catch {
      /* fall through */
    }
    return crypto.createHash('sha256').update(t).digest();
  }

  // No key provided: generate and persist one.
  const dir = process.env.DATA_DIR || './data';
  const file = path.join(dir, '.encryption-key');
  try {
    if (fs.existsSync(file)) {
      return crypto.createHash('sha256').update(fs.readFileSync(file)).digest();
    }
    fs.mkdirSync(dir, { recursive: true });
    const secret = crypto.randomBytes(48);
    fs.writeFileSync(file, secret, { mode: 0o600 });
    console.warn(
      `⚠️  ENCRYPTION_KEY non impostata: generata e salvata in ${file}. ` +
        'Fai il backup di questo file o imposta ENCRYPTION_KEY, altrimenti i segreti diventeranno illeggibili.'
    );
    return crypto.createHash('sha256').update(secret).digest();
  } catch (err) {
    console.warn('Impossibile persistere la chiave di cifratura, uso una chiave temporanea:', err.message);
    return crypto.createHash('sha256').update('insecure-default-key').digest();
  }
}

const KEY = loadKey();

export function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store iv:tag:ciphertext, base64.
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return null;
  try {
    const [ivB, tagB, dataB] = payload.split(':');
    const iv = Buffer.from(ivB, 'base64');
    const tag = Buffer.from(tagB, 'base64');
    const data = Buffer.from(dataB, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
