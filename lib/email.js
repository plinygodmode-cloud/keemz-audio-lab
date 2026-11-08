'use strict';

/*
  Resend transactional email: inquiry notifications and digital delivery.
  All interpolated values are HTML-escaped; plain-text alternatives are sent
  alongside the HTML so the delivery email survives strict mail clients.
*/

const { escapeHtml, isEmail, singleLine } = require('./util');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

class EmailError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'EmailError';
    this.meta = meta;
  }
}

async function sendEmail({ apiKey, from, to, subject, html, text, replyTo, bcc, idempotencyKey, timeoutMs = 12000 }) {
  if (!apiKey) throw new EmailError('RESEND_API_KEY is not configured.', { code: 'not-configured' });
  if (!from) throw new EmailError('EMAIL_FROM is not configured.', { code: 'not-configured' });
  const recipients = (Array.isArray(to) ? to : [to]).filter(isEmail);
  if (!recipients.length) throw new EmailError('No valid recipient address.', { code: 'bad-recipient' });

  const payload = {
    from,
    to: recipients,
    subject: singleLine(subject, 180) || 'Keemz Audio Lab',
    html,
    ...(text ? { text } : {}),
    ...(isEmail(replyTo) ? { reply_to: replyTo } : {}),
    ...(Array.isArray(bcc) && bcc.length ? { bcc: bcc.filter(isEmail) } : {})
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    throw new EmailError(
      error.name === 'AbortError' ? 'The email service timed out.' : 'The email service could not be reached.',
      { cause: error }
    );
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new EmailError('The email service rejected the message.', {
      status: response.status,
      detail: typeof data?.message === 'string' ? data.message : JSON.stringify(data).slice(0, 400)
    });
  }
  return { id: data.id || '', status: response.status };
}

function shell({ heading, intro, body, footer }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#05070d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070d;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#0a0f19;border:1px solid #1b2738;">
        <tr><td style="padding:30px 30px 8px;">
          <p style="margin:0 0 18px;font:400 10px/1.4 'Courier New',monospace;letter-spacing:3px;color:#00cfff;">KEEMZ AUDIO LAB</p>
          <h1 style="margin:0 0 16px;font:700 26px/1.2 Georgia,'Times New Roman',serif;color:#f2f6fc;letter-spacing:-.5px;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 22px;font:400 13px/1.8 Arial,Helvetica,sans-serif;color:#9fb0c6;">${escapeHtml(intro)}</p>
        </td></tr>
        <tr><td style="padding:0 30px 10px;font:400 13px/1.8 Arial,Helvetica,sans-serif;color:#d7e2ef;">${body}</td></tr>
        <tr><td style="padding:10px 30px 30px;font:400 11px/1.7 Arial,Helvetica,sans-serif;color:#6d7f96;">${footer}</td></tr>
      </table>
      <p style="max-width:580px;margin:16px auto 0;font:400 10px/1.6 Arial,sans-serif;color:#43536b;text-align:center;">
        You are receiving this because you used keemzaudiolab.com. If this was not you, reply to this email.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

/** Purchase confirmation with expiring private download links. */
function deliveryEmail({ order, links, siteUrl, expiresOn }) {
  const rows = links
    .map(
      link => `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #1b2738;">
          <a href="${escapeHtml(link.url)}" style="color:#00cfff;text-decoration:none;font-weight:bold;">${escapeHtml(link.name)}</a>
          <div style="font-size:11px;color:#71829a;padding-top:4px;">${escapeHtml(link.format)} · quantity ${link.quantity}</div>
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid #1b2738;">
          <a href="${escapeHtml(link.url)}" style="display:inline-block;background:#00cfff;color:#04121a;text-decoration:none;padding:8px 14px;font:bold 11px Arial,sans-serif;letter-spacing:1px;">DOWNLOAD</a>
        </td>
      </tr>`
    )
    .join('');

  const body = `
    <p style="margin:0 0 12px;">Payment confirmed. Your private download links are below.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;">${rows}</table>
    <p style="margin:0 0 8px;font-size:12px;color:#9fb0c6;">Each link is personal to this order and expires on <strong style="color:#e6eef8;">${escapeHtml(expiresOn)}</strong>. Save your files locally.</p>
    <p style="margin:0;font-size:12px;color:#9fb0c6;">Order reference: <strong style="color:#e6eef8;">${escapeHtml(order.ref)}</strong></p>`;

  const footer = `Licence: ${escapeHtml(
    links[0]?.licence || 'Standard licence'
  )} — see ${escapeHtml(siteUrl)}/licensing for the full terms. Questions? Reply to this email.`;

  const text = [
    'KEEMZ AUDIO LAB — your downloads are ready.',
    '',
    ...links.map(link => `- ${link.name} (x${link.quantity}): ${link.url}`),
    '',
    `Links expire on ${expiresOn}. Order reference: ${order.ref}.`,
    `Licence terms: ${siteUrl}/licensing`
  ].join('\n');

  return {
    subject: 'Your Keemz Audio Lab download links',
    html: shell({ heading: 'Your sounds are ready.', intro: 'Thanks for supporting the lab.', body, footer }),
    text
  };
}

/** Inquiry notification to the studio inbox. */
function inquiryEmail({ name, email, service, message, reference }) {
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#d7e2ef;">
      <tr><td style="padding:4px 0;color:#71829a;width:92px;">Name</td><td style="padding:4px 0;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:4px 0;color:#71829a;">Email</td><td style="padding:4px 0;">${escapeHtml(email)}</td></tr>
      <tr><td style="padding:4px 0;color:#71829a;">Service</td><td style="padding:4px 0;">${escapeHtml(service)}</td></tr>
      <tr><td style="padding:4px 0;color:#71829a;">Reference</td><td style="padding:4px 0;">${escapeHtml(reference)}</td></tr>
    </table>
    <div style="margin-top:18px;padding:16px;border-left:2px solid #00cfff;background:#0d1420;white-space:pre-wrap;font-size:13px;line-height:1.75;">${escapeHtml(
      message
    )}</div>`;

  return {
    subject: `New ${service} inquiry — ${name}`,
    html: shell({
      heading: 'New project inquiry',
      intro: 'Sent from the contact form on keemzaudiolab.com.',
      body,
      footer: `Reply directly to this email to answer ${escapeHtml(name)}.`
    }),
    text: `New inquiry\n\nName: ${name}\nEmail: ${email}\nService: ${service}\nReference: ${reference}\n\n${message}`
  };
}

module.exports = { sendEmail, deliveryEmail, inquiryEmail, EmailError };
