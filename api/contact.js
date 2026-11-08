const crypto = require('node:crypto');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const respond = (res, status, data) => res.status(status).json(data);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return respond(res, 405, { error: 'Method not allowed.' });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.CONTACT_TO_EMAIL) return respond(res, 503, { error: 'The inquiry form is not connected to an email service yet.' });
  const origin = req.headers.origin;
  if (origin && process.env.SITE_URL) {
    try { if (new URL(origin).host !== new URL(process.env.SITE_URL).host) return respond(res, 403, { error: 'Origin not allowed.' }); }
    catch { return respond(res, 403, { error: 'Origin not allowed.' }); }
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.website) return respond(res, 200, { ok: true }); // honeypot
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const service = String(body.service || '').trim();
  const message = String(body.message || '').trim();
  if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200 || !service || message.length < 10 || message.length > 5000) {
    return respond(res, 400, { error: 'Please check the name, email, service and message fields.' });
  }
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#172033"><h2>New Keemz Audio Lab inquiry</h2><p><b>Name:</b> ${escapeHtml(name)}</p><p><b>Email:</b> ${escapeHtml(email)}</p><p><b>Service:</b> ${escapeHtml(service)}</p><hr><p style="white-space:pre-wrap">${escapeHtml(message)}</p></div>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `kal-inquiry-${crypto.randomUUID()}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [process.env.CONTACT_TO_EMAIL], reply_to: email, subject: `New ${service} inquiry — ${name}`, html })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Resend contact error:', response.status, result);
      return respond(res, 502, { error: 'The email service rejected the inquiry. Please try again later.' });
    }
    return respond(res, 200, { ok: true });
  } catch (error) {
    console.error('Contact email error:', error);
    return respond(res, 502, { error: 'The email service could not be reached. Please try again later.' });
  }
};
