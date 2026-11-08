'use strict';

const crypto = require('node:crypto');

const config = require('../lib/config');
const { json, fail, readJsonBody, requireJsonContentType, methodNotAllowed } = require('../lib/http');
const { checkOrigin, clientIp } = require('../lib/security');
const { isEmail, multiLine, singleLine } = require('../lib/util');
const { sendEmail, inquiryEmail } = require('../lib/email');
const { verifyTurnstile } = require('../lib/turnstile');
const { rateLimit } = require('../lib/store');

/*
  POST /api/contact
  Body: { name, email, service, message, website (honeypot), turnstileToken? }

  Protections, in order: JSON-only content type, origin allowlist, per-IP
  rate limits (burst + hourly), hidden honeypot field, optional Cloudflare
  Turnstile, strict validation and HTML escaping before Resend sees it.
*/
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!requireJsonContentType(req)) {
    return json(res, 415, { error: 'Inquiry requests must be sent as JSON.' });
  }

  const origin = checkOrigin(req, config.allowedOrigins());
  if (!origin.ok) {
    console.warn('[keemz] contact origin rejected:', origin.reason, req.headers.origin);
    return json(res, 403, { error: 'This request came from an unrecognised origin.' });
  }

  const emailConfig = config.emailConfig();
  if (!emailConfig.resendKey || !emailConfig.from || !emailConfig.contactTo) {
    console.error('[keemz] contact form not configured (RESEND_API_KEY / EMAIL_FROM / CONTACT_TO_EMAIL)');
    return json(res, 503, { error: 'The inquiry form is not connected to an email service yet.' });
  }

  const ip = clientIp(req);
  const body = readJsonBody(req);
  if (!body.ok) return json(res, body.status, { error: body.error });
  const payload = body.value || {};

  // Honeypot: bots fill hidden fields. Accept silently.
  if (typeof payload.website === 'string' && payload.website.trim()) {
    console.info('[keemz] contact honeypot triggered');
    return json(res, 200, { ok: true });
  }

  const name = singleLine(payload.name, 100);
  const email = String(payload.email || '').trim().toLowerCase();
  const service = singleLine(payload.service, 60);
  const rawMessage = String(payload.message || '');
  const message = multiLine(payload.message, 5000);
  const allowedServices = config.contactServices();

  if (name.length < 2) return json(res, 400, { error: 'Please tell us your name.' });
  if (!isEmail(email)) return json(res, 400, { error: 'Please enter a valid email address.' });
  if (!allowedServices.includes(service)) {
    return json(res, 400, { error: 'Please choose one of the listed services.' });
  }
  if (message.length < 10) return json(res, 400, { error: 'Please add a little more detail about the project (at least 10 characters).' });
  if (rawMessage.length > 5000) return json(res, 400, { error: 'That message is too long. Please keep it under 5000 characters.' });

  // Cheap validation happens first so a typo never burns the send quota.
  const burst = await rateLimit(`contact:ip:${ip}`, { limit: 4, windowSeconds: 600 });
  const hourly = await rateLimit(`contact:hour:${ip}`, { limit: 12, windowSeconds: 3600 });
  if (!burst.allowed || !hourly.allowed) {
    res.setHeader('Retry-After', String(Math.max(burst.retryAfter, hourly.retryAfter)));
    return json(res, 429, { error: 'Too many messages from this connection. Please try again later.' });
  }

  const turnstile = config.turnstileConfig();
  if (turnstile.secret) {
    const check = await verifyTurnstile({
      secret: turnstile.secret,
      token: payload.turnstileToken,
      remoteIp: ip,
      expectedHostname: turnstile.expectedHostname
    });
    if (!check.ok) {
      console.warn('[keemz] contact turnstile rejected:', check.reason, check.codes || '');
      return json(res, 400, { error: 'The spam check could not be completed. Please refresh the page and try again.' });
    }
  }

  const reference = `KAL-INQ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const messageBody = inquiryEmail({ name, email, service, message, reference });

  try {
    await sendEmail({
      apiKey: emailConfig.resendKey,
      from: emailConfig.from,
      to: emailConfig.contactTo,
      subject: messageBody.subject,
      html: messageBody.html,
      text: messageBody.text,
      replyTo: email,
      idempotencyKey: `kal-inquiry-${reference}`
    });
    return json(res, 200, { ok: true, reference });
  } catch (error) {
    if (error.name === 'EmailError' && error.meta?.status === 422) {
      console.error('[keemz] Resend rejected the inquiry (check EMAIL_FROM domain verification):', error.meta.detail);
      return json(res, 502, { error: 'The email service rejected this message. Please contact the studio directly.' });
    }
    return fail(res, 502, 'The email service could not be reached. Please try again in a moment.', error);
  }
};
