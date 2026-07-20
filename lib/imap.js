import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

// Open a short-lived IMAP connection, run `fn`, and always close it. Keeping
// connections per-request keeps the server simple and stateless.
async function withClient(session, fn) {
  const client = new ImapFlow({
    host: session.imap.host,
    port: session.imap.port,
    secure: session.imap.secure,
    auth: session.imap.auth,
    logger: false,
  });
  await client.connect();
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
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: config.imap.auth,
    logger: false,
  });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`IMAP login failed: ${err.message}`);
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
