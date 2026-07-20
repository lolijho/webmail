import nodemailer from 'nodemailer';

// Generous timeouts: many cloud hosts (including some Coolify VPS) are slow to
// open outbound SMTP connections, or block them entirely.
function transportOptions(smtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.auth,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  };
}

function transporter(session) {
  return nodemailer.createTransport(transportOptions(session.smtp));
}

// Turn a raw nodemailer error into an actionable, human message.
function describeSmtpError(err) {
  const msg = err && err.message ? err.message : String(err);
  const code = err && err.code;
  if (code === 'EAUTH' || /auth/i.test(msg)) {
    return 'Autenticazione SMTP fallita: email o password non corretti. Con Gmail, Outlook o Yahoo protetti da verifica in due passaggi usa una "App Password".';
  }
  if (/ENOTFOUND|EAI_AGAIN|EDNS/i.test(msg)) {
    return 'Host SMTP non trovato: controlla il nome del server (es. smtp.gmail.com).';
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(msg)) {
    return 'Connessione SMTP rifiutata: porta errata o servizio non attivo (di solito 465 con SSL, oppure 587 con STARTTLS).';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return "Timeout di connessione al server SMTP. Molti provider cloud/VPS bloccano le porte di posta in uscita (25, 465, 587): verifica che il tuo host Coolify le consenta, altrimenti usa un servizio SMTP dedicato.";
  }
  if (/certificate|self.signed|CERT_/i.test(msg)) {
    return 'Errore del certificato TLS del server SMTP: il certificato non è valido per questo host.';
  }
  return `Connessione SMTP fallita: ${msg}`;
}

export async function verifySmtp(config) {
  const t = nodemailer.createTransport(transportOptions(config.smtp));
  try {
    await t.verify();
  } catch (err) {
    throw new Error(describeSmtpError(err));
  } finally {
    t.close();
  }
}

export async function sendMail(session, msg) {
  const t = transporter(session);
  try {
    return await t.sendMail({
      from: session.email,
      to: msg.to,
      cc: msg.cc || undefined,
      bcc: msg.bcc || undefined,
      subject: msg.subject || '(no subject)',
      text: msg.text || undefined,
      html: msg.html || undefined,
      inReplyTo: msg.inReplyTo || undefined,
      references: msg.references || undefined,
    });
  } catch (err) {
    throw new Error(describeSmtpError(err));
  } finally {
    t.close();
  }
}
