import nodemailer from 'nodemailer';

// Direct SMTP sending through the user's own mail server. Auth reuses the
// mailbox credentials (same email + password as IMAP), as is standard on
// cPanel and most providers.

function transportOptions(account) {
  return {
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.email, pass: account.imap.auth.pass },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  };
}

function describeSmtpError(err) {
  const msg = err && err.message ? err.message : String(err);
  const code = err && err.code;
  if (code === 'EAUTH' || /auth/i.test(msg)) {
    return 'Autenticazione SMTP fallita: la password della casella non è corretta (di solito è la stessa dell’IMAP).';
  }
  if (/ENOTFOUND|EAI_AGAIN|EDNS/i.test(msg)) {
    return 'Host SMTP non trovato: controlla il nome del server (es. smtp.tuodominio.com).';
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(msg)) {
    return 'Connessione SMTP rifiutata: porta errata (465 con SSL, 587 con STARTTLS).';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return 'Timeout SMTP: la porta è bloccata in uscita dall’host. Su Hetzner la 25 è bloccata di default; usa la 465/587, oppure invia tramite Resend.';
  }
  if (/certificate|self.signed|CERT_/i.test(msg)) {
    return 'Errore del certificato TLS del server SMTP.';
  }
  return `Invio SMTP fallito: ${msg}`;
}

export async function verifySmtp(account) {
  const t = nodemailer.createTransport(transportOptions(account));
  try {
    await t.verify();
  } catch (err) {
    throw new Error(describeSmtpError(err));
  } finally {
    t.close();
  }
}

export async function sendViaSmtp(account, msg) {
  const t = nodemailer.createTransport(transportOptions(account));
  try {
    const info = await t.sendMail({
      from: account.email,
      to: msg.to,
      cc: msg.cc || undefined,
      bcc: msg.bcc || undefined,
      subject: msg.subject || '(no subject)',
      text: msg.text || undefined,
      html: msg.html || undefined,
      inReplyTo: msg.inReplyTo || undefined,
      references: msg.references || undefined,
    });
    return { messageId: info.messageId };
  } catch (err) {
    throw new Error(describeSmtpError(err));
  } finally {
    t.close();
  }
}
