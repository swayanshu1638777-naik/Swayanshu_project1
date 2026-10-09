const { HttpError } = require('../utils/http');

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

async function deliverOtp(payload, code, env = process.env) {
  const provider = selectedProvider(env);
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
    if (env.NODE_ENV === 'production' && endpoint.protocol !== 'https:') {
      throw new HttpError(503, 'OTP_DELIVERY_URL must use HTTPS in production');
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.OTP_DELIVERY_TOKEN ? { authorization: `Bearer ${env.OTP_DELIVERY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        email: payload.email,
        phone: payload.phone,
        code,
        expiresInMinutes: Number(env.OTP_EXPIRY_MINUTES) || 10,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new HttpError(502, `OTP delivery failed with status ${response.status}`);
    return;
  }

  if (provider === 'resend') {
    if (!env.RESEND_API_KEY || !env.OTP_FROM_EMAIL) {
      throw new HttpError(503, 'Resend OTP delivery is not configured');
    }
    const safeName = escapeHtml(payload.full_name);
    const expiresInMinutes = Number(env.OTP_EXPIRY_MINUTES) || 10;
    const response = await fetch('https://api.resend.com/emails', {
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
    });
    if (!response.ok) throw new HttpError(502, `OTP email delivery failed with status ${response.status}`);
    return;
  }

  throw new HttpError(503, 'OTP_DELIVERY_PROVIDER must be resend or webhook');
}

module.exports = { deliverOtp, selectedProvider };
