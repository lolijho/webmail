// In-memory session store mapping an opaque session id (kept in an httpOnly
// cookie) to a logged-in app user id. Sessions expire after 12h.

const SESSIONS = new Map();
const TTL_MS = 1000 * 60 * 60 * 12;

export function createSession(sid, userId) {
  SESSIONS.set(sid, { userId, createdAt: Date.now() });
}

export function getSession(sid) {
  const s = SESSIONS.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > TTL_MS) {
    SESSIONS.delete(sid);
    return null;
  }
  return s;
}

export function destroySession(sid) {
  SESSIONS.delete(sid);
}

// Periodic sweep of expired sessions.
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of SESSIONS) {
    if (now - s.createdAt > TTL_MS) SESSIONS.delete(sid);
  }
}, 1000 * 60 * 30).unref();
