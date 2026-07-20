import nodemailer from 'nodemailer';

function transporter(session) {
  return nodemailer.createTransport({
    host: session.smtp.host,
    port: session.smtp.port,
    secure: session.smtp.secure,
    auth: session.smtp.auth,
  });
}

export async function verifySmtp(config) {
  const t = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.auth,
  });
  try {
    await t.verify();
  } catch (err) {
    throw new Error(`SMTP login failed: ${err.message}`);
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
  } finally {
    t.close();
  }
}
