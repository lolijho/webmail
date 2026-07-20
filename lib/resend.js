// Sending via the Resend HTTP API (https://resend.com). This goes over HTTPS
// (port 443), so it works even when the host blocks outbound SMTP ports
// (25/465/587) — the common case on Coolify/VPS. Enabled by setting the
// RESEND_API_KEY environment variable.

export function resendConfigured() {
  return !!process.env.RESEND_API_KEY;
}

// The From address Resend will use. Resend requires it to be on a domain you
// verified in your Resend account. Set MAIL_FROM to that address (optionally
// "Nome <me@dominio.it>"); otherwise the logged-in email is used.
export function resendFrom(sessionEmail) {
  return process.env.MAIL_FROM || sessionEmail;
}

function toArray(v) {
  if (!v) return undefined;
  if (Array.isArray(v)) return v;
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendViaResend({
  from,
  to,
  cc,
  bcc,
  subject,
  text,
  html,
  inReplyTo,
  references,
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY non configurata');

  const payload = {
    from,
    to: toArray(to),
    cc: toArray(cc),
    bcc: toArray(bcc),
    subject: subject || '(no subject)',
    text: text || undefined,
    html: html || undefined,
  };

  // Threading headers so replies group correctly in the recipient's client.
  const headers = {};
  if (inReplyTo) headers['In-Reply-To'] = inReplyTo;
  if (references) headers['References'] = references;
  if (Object.keys(headers).length) payload.headers = headers;

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Impossibile contattare Resend: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.message || data.name || `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new Error('Resend: API key non valida. Controlla RESEND_API_KEY.');
    }
    // The most common failure: sending from an unverified domain.
    if (res.status === 403 || /domain|verif/i.test(detail)) {
      throw new Error(
        `Resend ha rifiutato l'invio: ${detail}. Il mittente (${from}) deve essere su un dominio verificato nel tuo account Resend. Verifica il dominio su resend.com/domains e imposta MAIL_FROM con un indirizzo di quel dominio.`
      );
    }
    throw new Error(`Resend: ${detail}`);
  }
  return { messageId: data.id };
}
