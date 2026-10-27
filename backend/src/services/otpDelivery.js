const { HttpError } = require('../utils/http');
const { getOtpExpiryMinutes } = require('../utils/productionConfig');
const nodemailer = require('nodemailer');

function selectedProvider(env = process.env) {
  if (env.OTP_DELIVERY_PROVIDER) return env.OTP_DELIVERY_PROVIDER;
  if (env.OTP_DELIVERY_URL) return 'webhook';
  return env.NODE_ENV === 'production' ? 'resend' : 'console';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function sendOtpRequest(url, options, failureMessage) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new HttpError(502, failureMessage);
  }
}

async function deliverOtp(payload, code, env = process.env) {
  const provider = selectedProvider(env);
  const expiresInMinutes = getOtpExpiryMinutes(env);
  if (provider === 'console' && env.NODE_ENV !== 'production') {
    console.info(`Development registration OTP for ${payload.email}: ${code}`);
    return;
  }

  if (provider === 'webhook') {
    let endpoint;
    try {
      endpoint = new URL(env.OTP_DELIVERY_URL);
    } catch (error) {
      throw new HttpError(503, 'OTP delivery provider is not configured');
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)
        || (env.NODE_ENV === 'production' && endpoint.protocol !== 'https:')) {
      throw new HttpError(503, 'OTP_DELIVERY_URL must use HTTP or HTTPS, and HTTPS in production');
    }
    const response = await sendOtpRequest(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.OTP_DELIVERY_TOKEN ? { authorization: `Bearer ${env.OTP_DELIVERY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        email: payload.email,
        phone: payload.phone,
        code,
        expiresInMinutes,
      }),
      signal: AbortSignal.timeout(10000),
    }, 'OTP delivery provider could not be reached');
    if (!response.ok) throw new HttpError(502, `OTP delivery failed with status ${response.status}`);
    return;
  }

  if (provider === 'resend') {
    if (!env.RESEND_API_KEY || !env.OTP_FROM_EMAIL) {
      throw new HttpError(503, 'Resend OTP delivery is not configured');
    }
    const safeName = escapeHtml(payload.full_name);
    const response = await sendOtpRequest('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.OTP_FROM_EMAIL,
        to: [payload.email],
        subject: 'Your college portal verification code',
        text: `Hello ${payload.full_name}, your verification code is ${code}. It expires in ${expiresInMinutes} minutes.`,
        html: `<p>Hello ${safeName},</p><p>Your college portal verification code is <strong>${code}</strong>.</p><p>It expires in ${expiresInMinutes} minutes.</p>`,
      }),
      signal: AbortSignal.timeout(10000),
    }, 'OTP email provider could not be reached');
    if (!response.ok) throw new HttpError(502, `OTP email delivery failed with status ${response.status}`);
    return;
  }

  if (provider === 'brevo-smtp') {
    if (!env.BREVO_SMTP_USER || !env.BREVO_SMTP_KEY || !env.OTP_FROM_EMAIL) {
      throw new HttpError(503, 'Brevo SMTP OTP delivery is not configured');
    }
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: env.BREVO_SMTP_USER,
        pass: env.BREVO_SMTP_KEY,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    const safeName = escapeHtml(payload.full_name);
    try {
      await transporter.sendMail({
        from: env.OTP_FROM_EMAIL,
        to: payload.email,
        subject: 'Your college portal verification code',
        text: `Hello ${payload.full_name}, your verification code is ${code}. It expires in ${expiresInMinutes} minutes.`,
        html: `<p>Hello ${safeName},</p><p>Your college portal verification code is <strong>${code}</strong>.</p><p>It expires in ${expiresInMinutes} minutes.</p>`,
      });
    } catch (error) {
      if (error.code === 'EAUTH' && /unauthorized ip address/i.test(error.message)) {
        throw new HttpError(503, 'Brevo SMTP rejected this server IP. Allowlist its outbound IP in Brevo and retry.');
      }
      throw new HttpError(502, 'OTP email delivery failed through Brevo SMTP');
    } finally {
      transporter.close();
    }
    return;
  }

  throw new HttpError(503, 'OTP_DELIVERY_PROVIDER must be resend, brevo-smtp, or webhook');
}

module.exports = { deliverOtp, selectedProvider };
