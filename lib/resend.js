// Sending via the Resend HTTP API (https://resend.com). This goes over HTTPS
// (port 443), so it works even when the host blocks outbound SMTP ports
// (25/465/587) — the common case on Coolify/VPS. Enabled by setting the
// RESEND_API_KEY environment variable.

// Resolve the effective Resend API key: a per-user key takes precedence over
// the global RESEND_API_KEY environment variable.
export function resolveResendKey(userKey) {
  return userKey || process.env.RESEND_API_KEY || null;
}

export function resendConfigured(userKey) {
  return !!resolveResendKey(userKey);
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
  apiKey,
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
  apiKey = apiKey || process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Nessuna API key Resend configurata');

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
        `Resend ha rifiutato l'invio: ${detail}. Il mittente (${from}) deve essere su un dominio verificato nel tuo account Resend. Verifica il dominio su resend.com/domains, oppure usa un indirizzo email di un dominio già verificato.`
      );
    }
    throw new Error(`Resend: ${detail}`);
  }
  return { messageId: data.id };
}
