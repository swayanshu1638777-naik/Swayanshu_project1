const assert = require('node:assert/strict');
const { test } = require('node:test');
const nodemailer = require('nodemailer');
const { deliverOtp } = require('../src/services/otpDelivery');

const originalFetch = global.fetch;
const originalCreateTransport = nodemailer.createTransport;

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

test('provider network failures return an explicit upstream error', async () => {
  global.fetch = async () => { throw new Error('network failure'); };
  try {
    await assert.rejects(deliverOtp({ email: 'student@college.test', full_name: 'Student' }, '123456', {
      OTP_DELIVERY_PROVIDER: 'resend',
      OTP_FROM_EMAIL: 'test-sender@college.test',
      RESEND_API_KEY: 'test-resend-api-key',
    }), { status: 502, message: 'OTP email provider could not be reached' });
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

test('Brevo SMTP sends a safely formatted registration code using configured credentials', async () => {
  let transportConfig;
  let message;
  nodemailer.createTransport = (config) => {
    transportConfig = config;
    return {
      sendMail: async (options) => { message = options; },
      close: () => {},
    };
  };
  try {
    await deliverOtp({ email: 'student@college.test', full_name: '<Student>' }, '123456', {
      OTP_DELIVERY_PROVIDER: 'brevo-smtp',
      OTP_EXPIRY_MINUTES: '10',
      BREVO_SMTP_USER: 'test-smtp-user',
      BREVO_SMTP_KEY: 'test-smtp-key',
      OTP_FROM_EMAIL: 'test-sender@college.test',
    });
    assert.equal(transportConfig.host, 'smtp-relay.brevo.com');
    assert.equal(transportConfig.port, 587);
    assert.equal(transportConfig.requireTLS, true);
    assert.deepEqual(transportConfig.auth, { user: 'test-smtp-user', pass: 'test-smtp-key' });
    assert.equal(message.to, 'student@college.test');
    assert.equal(message.from, 'test-sender@college.test');
    assert.match(message.text, /123456/);
    assert.match(message.html, /&lt;Student&gt;/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('Brevo SMTP delivery failures return a provider error without exposing SMTP details', async () => {
  nodemailer.createTransport = () => ({
    sendMail: async () => { throw new Error('sensitive SMTP response'); },
    close: () => {},
  });
  try {
    await assert.rejects(deliverOtp({ email: 'student@college.test', full_name: 'Student' }, '123456', {
      OTP_DELIVERY_PROVIDER: 'brevo-smtp',
      BREVO_SMTP_USER: 'test-smtp-user',
      BREVO_SMTP_KEY: 'test-smtp-key',
      OTP_FROM_EMAIL: 'test-sender@college.test',
    }), { status: 502, message: 'OTP email delivery failed through Brevo SMTP' });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('Brevo SMTP identifies IP allowlist failures without exposing provider details', async () => {
  nodemailer.createTransport = () => ({
    sendMail: async () => {
      const error = new Error('Invalid login: 525 5.7.1 Unauthorized IP address');
      error.code = 'EAUTH';
      throw error;
    },
    close: () => {},
  });
  try {
    await assert.rejects(deliverOtp({ email: 'student@college.test', full_name: 'Student' }, '123456', {
      OTP_DELIVERY_PROVIDER: 'brevo-smtp',
      BREVO_SMTP_USER: 'test-smtp-user',
      BREVO_SMTP_KEY: 'test-smtp-key',
      OTP_FROM_EMAIL: 'test-sender@college.test',
    }), {
      status: 503,
      message: 'Brevo SMTP rejected this server IP. Allowlist its outbound IP in Brevo and retry.',
    });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});