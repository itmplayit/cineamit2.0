'use strict';

const https = require('https');
const nodemailer = require('nodemailer');
const Config = require('../core/config');

// Legacy callers may inspect lastError; new callers should use the per-request
// result from deliverOtpEmail so concurrent requests cannot swap error messages.
const Mailer = { lastError: '', debugLog: [] };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const HTTP_TIMEOUT = 8000;

function safeError(value, extraSecrets = []) {
  let text = String(value || 'Unknown mail error').replace(/[\r\n\0]/g, ' ');
  for (const secret of [Config.BREVO_API_KEY, Config.RESEND_API_KEY, Config.SMTP_PASS, ...extraSecrets]) {
    if (secret) text = text.split(String(secret)).join('[redacted]');
  }
  return text.replace(/[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/g, '[email]').slice(0, 400);
}

Mailer.configurationError = function configurationError() {
  if (String(Config.MAIL_FROM || '').trim().length > 254 || !EMAIL.test(String(Config.MAIL_FROM || '').trim()) || /[\0\r\n]/.test(String(Config.MAIL_FROM || ''))) return 'MAIL_FROM must be a valid sender email in .env.';
  if (Config.BREVO_API_KEY || Config.RESEND_API_KEY) return '';
  if (!Config.SMTP_HOST || !Config.SMTP_USER || !Config.SMTP_PASS) {
    return 'Configure BREVO_API_KEY / RESEND_API_KEY, or SMTP_HOST / SMTP_USER / SMTP_PASS in .env.';
  }
  const port = Number(Config.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'SMTP_PORT must be between 1 and 65535.';
  return '';
};

function httpPostJson(url, payload, headers) {
  return new Promise((resolve) => {
    let req, deadline, done = false;
    const finish = (code, body) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve([code, body]);
    };
    try {
      const body = JSON.stringify(payload);
      req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
      }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 65536) {
            finish(0, 'Mail provider response exceeded 64 KiB.');
            res.destroy(); req.destroy();
          } else chunks.push(chunk);
        });
        res.on('end', () => finish(res.statusCode || 0, Buffer.concat(chunks).toString('utf8')));
        res.on('error', error => finish(0, error.message));
        res.on('aborted', () => finish(0, 'Mail provider response was interrupted.'));
      });
      req.on('error', error => finish(0, error.message));
      deadline = setTimeout(() => {
        finish(0, 'Mail provider request timed out.');
        req.destroy();
      }, HTTP_TIMEOUT);
      req.end(body);
    } catch (error) {
      finish(0, error.message);
      if (req) req.destroy();
    }
  });
}

function providerMessage(body) {
  try {
    const value = JSON.parse(body);
    const detail = value.message || value.error || value.code || value.name || body;
    return typeof detail === 'string' ? detail : JSON.stringify(detail);
  } catch { return body; }
}

function otpTemplate(otp, validMinutes, kind) {
  const pin = kind === 'pin';
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0f1014;color:#fff;padding:24px;margin:0">
<div style="max-width:500px;margin:auto;background:#141519;padding:30px;border-radius:12px;border:1px solid #374151">
<h2 style="color:#fe1a63;text-align:center">CINEAMIT</h2>
<h3>${pin ? 'Private downloads PIN reset' : 'Password reset'}</h3>
<p>Use this verification code to continue:</p>
<p style="font:700 34px monospace;letter-spacing:8px;text-align:center;color:#fff;padding:20px;border:1px solid #fe1a63;border-radius:10px">${otp}</p>
<p>This code expires in ${validMinutes} minutes. Do not share it with anyone.</p>
<p style="color:#9ca3af">If you did not request this, ignore this email. Your ${pin ? 'PIN' : 'password'} will remain unchanged.</p>
</div></body></html>`;
}

Mailer.deliverOtpEmail = async function deliverOtpEmail(userEmail, otp, validMinutes = 10, kind = 'password') {
  const debug = [], failures = [];
  const log = message => { debug.push(message); console.error('[Mailer] ' + message); };
  const finish = result => {
    Mailer.lastError = result.ok ? '' : result.error;
    Mailer.debugLog = debug.slice(-12);
    return result;
  };
  userEmail = String(userEmail || '').trim();
  otp = String(otp || '');
  if (userEmail.length > 254 || /[\0\r\n]/.test(userEmail) || !EMAIL.test(userEmail)) return finish({ ok: false, provider: '', error: 'Invalid recipient email address.' });
  if (!/^\d{6}$/.test(otp) || !Number.isInteger(validMinutes) || validMinutes < 1 || validMinutes > 60) {
    return finish({ ok: false, provider: '', error: 'Invalid OTP email parameters.' });
  }
  const configError = Mailer.configurationError();
  if (configError) { log(configError); return finish({ ok: false, provider: '', error: configError }); }
  const fromEmail = String(Config.MAIL_FROM).trim();
  const fromName = String(Config.MAIL_FROM_NAME || 'CineAmit').replace(/[\r\n\0<>"\\]/g, '');
  const subject = kind === 'pin' ? 'Your CineAmit Private PIN reset code' : 'Your CineAmit password reset code';
  const html = otpTemplate(otp, validMinutes, kind);
  const text = `${subject}\n\nYour verification code is: ${otp}\nValid for ${validMinutes} minutes. Do not share this code.\n\nIf you did not request this, ignore this email.`;
  const providers = [];
  if (Config.BREVO_API_KEY) providers.push({
    name: 'Brevo', url: 'https://api.brevo.com/v3/smtp/email',
    headers: { 'api-key': Config.BREVO_API_KEY, Accept: 'application/json' },
    payload: { sender: { email: fromEmail, name: fromName }, to: [{ email: userEmail }], subject, htmlContent: html },
  });
  if (Config.RESEND_API_KEY) providers.push({
    name: 'Resend', url: 'https://api.resend.com/emails',
    headers: { Authorization: 'Bearer ' + Config.RESEND_API_KEY },
    payload: { from: `${fromName} <${fromEmail}>`, to: [userEmail], subject, html, text },
  });
  for (const provider of providers) {
    const [code, body] = await httpPostJson(provider.url, provider.payload, provider.headers);
    if (code >= 200 && code < 300) {
      let messageId = '';
      try { const response = JSON.parse(body); messageId = String(response.messageId || response.id || ''); } catch {}
      log(provider.name + ': accepted by provider (inbox delivery is not guaranteed).');
      return finish({ ok: true, provider: provider.name, messageId, error: '' });
    }
    const error = safeError(`${provider.name} HTTP ${code}: ${providerMessage(body)}`, [otp]);
    failures.push(error); log(error);
  }
  if (Config.SMTP_HOST && Config.SMTP_USER && Config.SMTP_PASS) {
    const port = Number(Config.SMTP_PORT || 587);
    let transporter, smtpDeadline;
    try {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be between 1 and 65535.');
      transporter = nodemailer.createTransport({
        host: Config.SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user: Config.SMTP_USER, pass: Config.SMTP_PASS },
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000,
      });
      const info = await Promise.race([
        transporter.sendMail({
          from: { name: fromName, address: fromEmail },
          to: userEmail, subject, text, html,
        }),
        new Promise((resolve, reject) => {
          smtpDeadline = setTimeout(() => reject(new Error('SMTP request timed out.')), 20000);
        }),
      ]);
      if (!Array.isArray(info.accepted) || !info.accepted.some(email => String(email).toLowerCase() === userEmail.toLowerCase())) {
        throw new Error('SMTP server did not accept the recipient.');
      }
      log(`SMTP ${port}: accepted by server (inbox delivery is not guaranteed).`);
      return finish({ ok: true, provider: 'SMTP', messageId: String(info.messageId || ''), error: '' });
    } catch (error) {
      const detail = safeError('SMTP: ' + error.message, [otp]);
      failures.push(detail); log(detail);
    } finally {
      clearTimeout(smtpDeadline);
      if (transporter) { try { transporter.close(); } catch {} }
    }
  }
  return finish({ ok: false, provider: '', error: failures.join(' | ').slice(0, 1000) || 'No usable mail provider is configured.' });
};

Mailer.sendOtpEmail = async function sendOtpEmail(...args) {
  return (await Mailer.deliverOtpEmail(...args)).ok;
};

module.exports = Mailer;
