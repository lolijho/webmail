import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

// Shared connection options with generous timeouts. Defaults are short, which
// on a remote host (e.g. Coolify) surfaces as "Failed to establish connection
// in required time" whenever the mail server is a little slow to answer.
function clientOptions(imap) {
  return {
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: imap.auth,
    logger: false,
    connectionTimeout: 20000, // TCP + TLS handshake
    greetingTimeout: 15000, // wait for server greeting
    socketTimeout: 60000, // idle socket
    tls: { rejectUnauthorized: true },
  };
}

// Turn a raw imapflow/socket error into an actionable, human message.
function describeImapError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (err && (err.authenticationFailed || err.serverResponseCode === 'AUTHENTICATIONFAILED')) {
    return 'Autenticazione IMAP fallita: email o password non corretti. Con Gmail, Outlook o Yahoo protetti da verifica in due passaggi devi generare una "App Password" e usarla al posto della password normale.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return 'Host IMAP non trovato: controlla il nome del server (es. imap.gmail.com).';
  }
  if (/ECONNREFUSED/i.test(msg)) {
    return 'Connessione IMAP rifiutata: porta errata o servizio non attivo (di solito 993 con SSL/TLS).';
  }
  if (/required time|timeout|ETIMEDOUT| EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return "Timeout di connessione al server IMAP. Verifica host e porta; se sei su Coolify o un VPS, controlla che il firewall/hosting consenta connessioni in uscita sulla porta IMAP (993).";
  }
  if (/certificate|self.signed|CERT_|altnames/i.test(msg)) {
    return 'Errore del certificato TLS del server IMAP: il certificato non è valido per questo host.';
  }
  if (/Command failed/i.test(msg)) {
    return "Il server IMAP ha rifiutato il login. Controlla le credenziali e, se richiesto dal provider, usa una App Password.";
  }
  return `Connessione IMAP fallita: ${msg}`;
}

// Open a short-lived IMAP connection, run `fn`, and always close it. Keeping
// connections per-request keeps the server simple and stateless.
async function withClient(session, fn) {
  const client = new ImapFlow(clientOptions(session.imap));
  try {
    await client.connect();
  } catch (err) {
    throw new Error(describeImapError(err));
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function verifyImap(config) {
  const client = new ImapFlow(clientOptions(config.imap));
  try {
    await client.connect();
  } catch (err) {
    throw new Error(describeImapError(err));
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

// Map well-known special-use flags to friendly roles so the UI can show icons.
function roleFor(box) {
  const map = {
    '\\Inbox': 'inbox',
    '\\Sent': 'sent',
    '\\Drafts': 'drafts',
    '\\Junk': 'junk',
    '\\Trash': 'trash',
    '\\Archive': 'archive',
  };
  if (box.specialUse && map[box.specialUse]) return map[box.specialUse];
  if (/^inbox$/i.test(box.path)) return 'inbox';
  return 'folder';
}

export async function listFolders(session) {
  return withClient(session, async (client) => {
    const list = await client.list();
    const folders = [];
    for (const box of list) {
      if (box.flags && box.flags.has('\\Noselect')) continue;
      folders.push({
        path: box.path,
        name: box.name,
        role: roleFor(box),
        specialUse: box.specialUse || null,
      });
    }
    // Sort: inbox first, then common roles, then alphabetical.
    const order = { inbox: 0, sent: 1, drafts: 2, archive: 3, junk: 4, trash: 5 };
    folders.sort((a, b) => {
      const oa = order[a.role] ?? 10;
      const ob = order[b.role] ?? 10;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
    return folders;
  });
}

function addressText(addr) {
  if (!addr) return '';
  return addr
    .map((a) => a.name || a.address || '')
    .filter(Boolean)
    .join(', ');
}

export async function listMessages(session, { folder, page, pageSize, search }) {
  return withClient(session, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const status = client.mailbox;
      const total = status.exists || 0;

      // Determine the set of sequence numbers to fetch (newest first).
      let uids = null;
      if (search) {
        uids = await client.search(
          { or: [{ subject: search }, { from: search }, { body: search }] },
          { uid: true }
        );
        uids = (uids || []).sort((a, b) => b - a);
      }

      let messages = [];
      if (search) {
        const start = (page - 1) * pageSize;
        const slice = uids.slice(start, start + pageSize);
        if (slice.length) {
          for await (const msg of client.fetch(
            slice.join(','),
            { uid: true, envelope: true, flags: true, size: true },
            { uid: true }
          )) {
            messages.push(formatEnvelope(msg));
          }
        }
        messages.sort((a, b) => b.uid - a.uid);
        return { total: uids.length, page, pageSize, folder, messages };
      }

      if (total === 0) {
        return { total: 0, page, pageSize, folder, messages: [] };
      }

      // Sequence-number window from the end (newest messages).
      const end = total - (page - 1) * pageSize;
      const startSeq = Math.max(1, end - pageSize + 1);
      if (end < 1) return { total, page, pageSize, folder, messages: [] };

      for await (const msg of client.fetch(
        `${startSeq}:${end}`,
        { uid: true, envelope: true, flags: true, size: true },
        { uid: false }
      )) {
        messages.push(formatEnvelope(msg));
      }
      messages.sort((a, b) => b.uid - a.uid);
      return { total, page, pageSize, folder, messages };
    } finally {
      lock.release();
    }
  });
}

function formatEnvelope(msg) {
  const env = msg.envelope || {};
  const flags = msg.flags || new Set();
  return {
    uid: msg.uid,
    subject: env.subject || '(no subject)',
    from: addressText(env.from),
    fromAddress: (env.from && env.from[0] && env.from[0].address) || '',
    to: addressText(env.to),
    date: env.date || null,
    messageId: env.messageId || null,
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    answered: flags.has('\\Answered'),
    size: msg.size || 0,
  };
}

export async function getMessage(session, { folder, uid }) {
  return withClient(session, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { meta, content } = await client.download(uid, undefined, {
        uid: true,
      });
      const parsed = await simpleParser(content);

      // Mark as read.
      try {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      } catch {
        /* ignore */
      }

      const attachments = (parsed.attachments || []).map((a) => ({
        filename: a.filename || 'attachment',
        contentType: a.contentType,
        size: a.size,
        content: a.content ? a.content.toString('base64') : null,
      }));

      return {
        uid,
        subject: parsed.subject || '(no subject)',
        from: parsed.from ? parsed.from.text : '',
        to: parsed.to ? parsed.to.text : '',
        cc: parsed.cc ? parsed.cc.text : '',
        date: parsed.date || null,
        messageId: parsed.messageId || null,
        references: parsed.references || null,
        html: parsed.html || null,
        text: parsed.text || null,
        attachments,
      };
    } finally {
      lock.release();
    }
  });
}

export async function setFlags(session, { folder, uid, add, remove }) {
  return withClient(session, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (add && add.length) {
        await client.messageFlagsAdd(uid, add, { uid: true });
      }
      if (remove && remove.length) {
        await client.messageFlagsRemove(uid, remove, { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}

export async function deleteMessage(session, { folder, uid }) {
  return withClient(session, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      // Try to move to Trash; fall back to a direct delete.
      let trashPath = null;
      const list = await client.list();
      for (const box of list) {
        if (box.specialUse === '\\Trash') trashPath = box.path;
      }
      if (trashPath && trashPath !== folder) {
        await client.messageMove(uid, trashPath, { uid: true });
      } else {
        await client.messageDelete(uid, { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}
