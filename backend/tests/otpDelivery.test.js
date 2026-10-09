const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deliverOtp } = require('../src/services/otpDelivery');

const originalFetch = global.fetch;

test('Resend sends the registration code by email using environment credentials', async () => {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200 };
  };
  try {
    await deliverOtp({ email: 'student@college.test', full_name: '<Student>', phone: '0000000000' }, '123456', {
      NODE_ENV: 'production',
      OTP_DELIVERY_PROVIDER: 'resend',
      OTP_EXPIRY_MINUTES: '10',
      OTP_FROM_EMAIL: 'test-sender@college.test',
      RESEND_API_KEY: 'test-resend-api-key',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.resend.com/emails');
    assert.equal(requests[0].options.headers.authorization, 'Bearer test-resend-api-key');
    const message = JSON.parse(requests[0].options.body);
    assert.deepEqual(message.to, ['student@college.test']);
    assert.equal(message.from, 'test-sender@college.test');
    assert.match(message.text, /123456/);
    assert.match(message.html, /&lt;Student&gt;/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Resend delivery errors do not expose provider response bodies', async () => {
  global.fetch = async () => ({ ok: false, status: 429 });
  try {
    await assert.rejects(deliverOtp({ email: 'student@college.test', full_name: 'Student' }, '123456', {
      OTP_DELIVERY_PROVIDER: 'resend',
      OTP_FROM_EMAIL: 'test-sender@college.test',
      RESEND_API_KEY: 'test-resend-api-key',
    }), { status: 502, message: 'OTP email delivery failed with status 429' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('legacy OTP webhook remains available and receives bearer authentication', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 202 };
  };
  try {
    await deliverOtp({ email: 'student@college.test', full_name: 'Student', phone: '0000000000' }, '123456', {
      OTP_DELIVERY_PROVIDER: 'webhook',
      OTP_DELIVERY_URL: 'https://otp.college.test/send',
      OTP_DELIVERY_TOKEN: 'test-only-webhook-token',
    });
    assert.equal(request.url.href, 'https://otp.college.test/send');
    assert.equal(request.options.headers.authorization, 'Bearer test-only-webhook-token');
    assert.equal(JSON.parse(request.options.body).code, '123456');
  } finally {
    global.fetch = originalFetch;
  }
});