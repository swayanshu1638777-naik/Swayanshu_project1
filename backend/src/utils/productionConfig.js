const seedPasswordKeys = [
  'DEFAULT_ADMIN_PASSWORD',
  'DEFAULT_TEACHER_PASSWORD',
  'DEFAULT_STUDENT_PASSWORD',
];

const weakJwtSecrets = new Set([
  'replace-with-a-long-random-secret',
  'your_jwt_secret_key_here',
  'local-development-secret-change-before-deploying',
]);

const demoAccountEmails = [
  'admin@ssipmt.com',
  'prof.sharma@ssipmt.com',
  'rahul@ssipmt.com',
  'aman@ssipmt.com',
  'ravi@ssipmt.com',
];

function getOtpExpiryMinutes(env = process.env) {
  const rawValue = env.OTP_EXPIRY_MINUTES;
  if (rawValue == null || rawValue === '') return 10;
  const minutes = Number(rawValue);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new Error('OTP_EXPIRY_MINUTES must be an integer between 1 and 60');
  }
  return minutes;
}

function isExampleHostname(hostname) {
  return hostname === 'example.com'
    || hostname.endsWith('.example.com')
    || hostname === 'invalid'
    || hostname.endsWith('.invalid')
    || hostname.includes('change-me')
    || hostname.includes('change_me')
    || hostname.startsWith('replace-with');
}

function validateProductionRuntimeConfig(env) {
  getOtpExpiryMinutes(env);
  if (env.TRUST_PROXY !== '1') {
    throw new Error('Set TRUST_PROXY=1 when running behind the single trusted Caddy proxy');
  }

  const secret = env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || new Set(secret).size < 16
      || weakJwtSecrets.has(secret) || secret.includes('CHANGE_ME')) {
    throw new Error('Set JWT_SECRET to a unique random value of at least 32 characters before starting in production');
  }

  const configuredOrigins = typeof env.CORS_ORIGIN === 'string'
    ? env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
  if (configuredOrigins.length === 0 || configuredOrigins.includes('*')) {
    throw new Error('Set CORS_ORIGIN to an explicit comma-separated list of trusted origins before starting in production');
  }

  for (const origin of configuredOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch (error) {
      throw new Error(`CORS_ORIGIN contains an invalid origin: ${origin}`);
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin
        || isExampleHostname(parsed.hostname)) {
      throw new Error(`CORS_ORIGIN entries must be trusted HTTPS origins without paths: ${origin}`);
    }
  }

  const otpProvider = env.OTP_DELIVERY_PROVIDER || (env.OTP_DELIVERY_URL ? 'webhook' : 'resend');
  if (otpProvider === 'resend' || otpProvider === 'brevo-smtp') {
    const fromEmail = env.OTP_FROM_EMAIL;
    const fromDomain = typeof fromEmail === 'string' ? fromEmail.split('@').at(-1) : '';
    if (otpProvider === 'resend') {
      if (typeof env.RESEND_API_KEY !== 'string' || !env.RESEND_API_KEY.trim()
          || env.RESEND_API_KEY.includes('CHANGE_ME')) {
        throw new Error('Set RESEND_API_KEY before starting OTP delivery with Resend in production');
      }
    } else if (typeof env.BREVO_SMTP_USER !== 'string' || !env.BREVO_SMTP_USER.trim()
        || typeof env.BREVO_SMTP_KEY !== 'string' || !env.BREVO_SMTP_KEY.trim()
        || env.BREVO_SMTP_USER.includes('CHANGE_ME') || env.BREVO_SMTP_KEY.includes('CHANGE_ME')) {
      throw new Error('Set BREVO_SMTP_USER and BREVO_SMTP_KEY before starting OTP delivery with Brevo SMTP in production');
    }
    if (typeof fromEmail !== 'string' || fromEmail.startsWith('CHANGE_ME')
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)
        || isExampleHostname(fromDomain)) {
      throw new Error('Set OTP_FROM_EMAIL to a valid sender address on a verified domain');
    }
  } else if (otpProvider === 'webhook') {
    let otpDeliveryUrl;
    try {
      otpDeliveryUrl = new URL(env.OTP_DELIVERY_URL);
    } catch (error) {
      throw new Error('Set OTP_DELIVERY_URL to a trusted HTTPS delivery endpoint before starting in production');
    }
    if (otpDeliveryUrl.protocol !== 'https:' || isExampleHostname(otpDeliveryUrl.hostname)) {
      throw new Error('OTP_DELIVERY_URL must be a trusted HTTPS delivery endpoint before starting in production');
    }
  } else {
    throw new Error('OTP_DELIVERY_PROVIDER must be resend, brevo-smtp, or webhook');
  }
  getProductionSeedPasswords(env);
}

function getProductionSeedPasswords(env) {
  const passwords = seedPasswordKeys.map((key) => {
    const password = env[key];
    if (typeof password !== 'string' || password.length < 12
        || Buffer.byteLength(password, 'utf8') > 72 || password.startsWith('CHANGE_ME')) {
      throw new Error(`${key} must be explicitly set to a non-placeholder password of 12 to 72 UTF-8 bytes before production seeding`);
    }
    return password;
  });
  if (new Set(passwords).size !== passwords.length) {
    throw new Error('Production seed passwords must be different for the admin, teacher, and student accounts');
  }
  return Object.fromEntries(seedPasswordKeys.map((key, index) => [key, passwords[index]]));
}

function getProductionAdminConfig(env) {
  const username = env.INITIAL_ADMIN_USERNAME;
  const email = env.INITIAL_ADMIN_EMAIL;
  const name = env.INITIAL_ADMIN_NAME;
  if (typeof username !== 'string' || !/^[A-Za-z0-9._-]{3,80}$/.test(username)
      || username.startsWith('CHANGE_ME')) {
    throw new Error('INITIAL_ADMIN_USERNAME must contain 3 to 80 letters, numbers, dots, underscores, or hyphens');
  }
  if (typeof email !== 'string' || email.length > 254
      || email.startsWith('CHANGE_ME')
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('INITIAL_ADMIN_EMAIL must be a valid email address');
  }
  if (demoAccountEmails.includes(email.toLowerCase())) {
    throw new Error('INITIAL_ADMIN_EMAIL must not use a development demo account email');
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || name.startsWith('CHANGE_ME')) {
    throw new Error('INITIAL_ADMIN_NAME must be explicitly set to a name of 1 to 120 characters');
  }
  return { username, email: email.toLowerCase(), name: name.trim() };
}

function assertNoDemoSeedAccounts(db) {
  const placeholders = demoAccountEmails.map(() => '?').join(', ');
  const account = db.prepare(`SELECT email FROM users WHERE email IN (${placeholders}) COLLATE NOCASE LIMIT 1`)
    .get(...demoAccountEmails);
  if (account) {
    throw new Error('Production cannot use a database containing development demo accounts; provision a clean production database');
  }
}

module.exports = {
  assertNoDemoSeedAccounts,
  getOtpExpiryMinutes,
  getProductionAdminConfig,
  getProductionSeedPasswords,
  validateProductionRuntimeConfig,
};
