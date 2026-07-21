import crypto from 'crypto';
import { promisify } from 'util';
import { createUser, getUserByUsername } from './db.js';

const scrypt = promisify(crypto.scrypt);

// Password hashing with scrypt (built-in, no dependency). Stored as
// scrypt$<saltB64>$<hashB64>.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, saltB, hashB] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB, 'base64');
    const expected = Buffer.from(hashB, 'base64');
    const derived = await scrypt(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

const USERNAME_RE = /^[a-zA-Z0-9._@+-]{3,64}$/;

export async function register(username, password) {
  username = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new Error('Username non valido (3-64 caratteri: lettere, numeri, . _ @ + -)');
  }
  if (!password || password.length < 8) {
    throw new Error('La password deve avere almeno 8 caratteri');
  }
  if (getUserByUsername(username)) {
    throw new Error('Username già registrato');
  }
  const password_hash = await hashPassword(password);
  return createUser(username, password_hash);
}

export async function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  const user = getUserByUsername(username);
  if (!user) throw new Error('Credenziali non valide');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new Error('Credenziali non valide');
  return { id: user.id, username: user.username };
}
