const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  assertNoDemoSeedAccounts,
  getOtpExpiryMinutes,
  getProductionAdminConfig,
  getProductionSeedPasswords,
  validateProductionRuntimeConfig,
} = require('../src/utils/productionConfig');
const { createDatabase } = require('../src/database');

const validSeedPasswords = {
  DEFAULT_ADMIN_PASSWORD: 'test-admin-password-long',
  DEFAULT_TEACHER_PASSWORD: 'test-teacher-password-long',
  DEFAULT_STUDENT_PASSWORD: 'test-student-password-long',
};
const validRuntimeConfig = {
  ...validSeedPasswords,
  TRUST_PROXY: '1',
  JWT_SECRET: 'test-jwt-secret-with-enough-distinct-characters',
  CORS_ORIGIN: 'https://portal.example.test,https://admin.example.test',
  OTP_DELIVERY_PROVIDER: 'webhook',
  OTP_DELIVERY_URL: 'https://otp-provider.example.test/deliver',
};
const validAdminConfig = {
  INITIAL_ADMIN_USERNAME: 'portal-admin',
  INITIAL_ADMIN_EMAIL: 'portal-admin@college.test',
  INITIAL_ADMIN_NAME: 'College Portal Administrator',
};

test('OTP expiry configuration defaults safely and rejects invalid durations', () => {
  assert.equal(getOtpExpiryMinutes({}), 10);
  assert.equal(getOtpExpiryMinutes({ OTP_EXPIRY_MINUTES: '1' }), 1);
  assert.equal(getOtpExpiryMinutes({ OTP_EXPIRY_MINUTES: '60' }), 60);
  for (const value of ['0', '-1', '61', '1.5', 'not-a-number']) {
    assert.throws(() => getOtpExpiryMinutes({ OTP_EXPIRY_MINUTES: value }), /between 1 and 60/);
  }
});

test('production runtime accepts strong JWT secret and explicit trusted CORS origins', () => {
  assert.doesNotThrow(() => validateProductionRuntimeConfig(validRuntimeConfig));
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    TRUST_PROXY: 'true',
  }), /TRUST_PROXY=1/);
});

test('production runtime rejects missing or weak JWT secrets', () => {
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    JWT_SECRET: 'replace-with-a-long-random-secret',
  }), /JWT_SECRET/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    JWT_SECRET: '',
  }), /JWT_SECRET/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    JWT_SECRET: 'CHANGE_ME_random-production-secret-with-more-than-32-characters',
  }), /JWT_SECRET/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    JWT_SECRET: 'x'.repeat(40),
  }), /JWT_SECRET/);
});

test('production runtime rejects wildcard and malformed CORS origins', () => {
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    CORS_ORIGIN: '*',
  }), /CORS_ORIGIN/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    CORS_ORIGIN: 'https://portal.example.com/admin',
  }), /trusted HTTPS origins/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    CORS_ORIGIN: 'http://portal.example.com',
  }), /HTTPS origins/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    CORS_ORIGIN: 'https://portal.example.com',
  }), /trusted HTTPS origins/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    CORS_ORIGIN: '',
  }), /CORS_ORIGIN/);
});

test('production runtime requires a non-placeholder HTTPS OTP delivery endpoint', () => {
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    OTP_DELIVERY_URL: '',
  }), /OTP_DELIVERY_URL/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    OTP_DELIVERY_URL: 'http://otp.example.net/deliver',
  }), /OTP_DELIVERY_URL/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    OTP_DELIVERY_URL: 'https://otp-provider.example.com/deliver',
  }), /OTP_DELIVERY_URL/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    OTP_DELIVERY_URL: 'https://replace-with-real-host.invalid/deliver',
  }), /OTP_DELIVERY_URL/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...validRuntimeConfig,
    OTP_DELIVERY_URL: 'https://change-me-otp-provider.com/deliver',
  }), /OTP_DELIVERY_URL/);
});

test('production runtime keeps existing webhook deployments working without a provider selector', () => {
  const webhookConfig = { ...validRuntimeConfig };
  delete webhookConfig.OTP_DELIVERY_PROVIDER;
  assert.doesNotThrow(() => validateProductionRuntimeConfig(webhookConfig));
});

test('production runtime validates the Resend email adapter configuration', () => {
  const resendConfig = {
    ...validRuntimeConfig,
    OTP_DELIVERY_PROVIDER: 'resend',
    RESEND_API_KEY: 'test-resend-api-key',
    OTP_FROM_EMAIL: 'portal@college.test',
  };
  delete resendConfig.OTP_DELIVERY_URL;
  assert.doesNotThrow(() => validateProductionRuntimeConfig(resendConfig));
  assert.throws(() => validateProductionRuntimeConfig({
    ...resendConfig,
    RESEND_API_KEY: '',
  }), /RESEND_API_KEY/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...resendConfig,
    OTP_FROM_EMAIL: 'portal@example.com',
  }), /OTP_FROM_EMAIL/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...resendConfig,
    OTP_FROM_EMAIL: 'CHANGE_ME_sender@college.edu',
  }), /OTP_FROM_EMAIL/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...resendConfig,
    OTP_DELIVERY_PROVIDER: 'unknown',
  }), /OTP_DELIVERY_PROVIDER/);
});

test('production runtime validates Brevo SMTP credentials and sender', () => {
  const brevoConfig = {
    ...validRuntimeConfig,
    OTP_DELIVERY_PROVIDER: 'brevo-smtp',
    BREVO_SMTP_USER: 'test-smtp-user',
    BREVO_SMTP_KEY: 'test-smtp-key',
    OTP_FROM_EMAIL: 'portal@college.test',
  };
  delete brevoConfig.OTP_DELIVERY_URL;
  assert.doesNotThrow(() => validateProductionRuntimeConfig(brevoConfig));
  assert.throws(() => validateProductionRuntimeConfig({
    ...brevoConfig,
    BREVO_SMTP_KEY: '',
  }), /BREVO_SMTP_USER and BREVO_SMTP_KEY/);
  assert.throws(() => validateProductionRuntimeConfig({
    ...brevoConfig,
    OTP_FROM_EMAIL: 'portal@example.com',
  }), /OTP_FROM_EMAIL/);
});

test('production seed requires distinct explicit passwords within bcrypt byte limits', () => {
  assert.deepEqual(getProductionSeedPasswords(validSeedPasswords), validSeedPasswords);
  assert.throws(() => getProductionSeedPasswords({
    ...validSeedPasswords,
    DEFAULT_ADMIN_PASSWORD: 'admin123',
  }), /non-placeholder password/);
  assert.throws(() => getProductionSeedPasswords({
    ...validSeedPasswords,
    DEFAULT_STUDENT_PASSWORD: 'x'.repeat(73),
  }), /12 to 72 UTF-8 bytes/);
  assert.throws(() => getProductionSeedPasswords({
    ...validSeedPasswords,
    DEFAULT_ADMIN_PASSWORD: 'CHANGE_ME_admin_password_at_least_12_chars',
  }), /12 to 72 UTF-8 bytes/);
  assert.throws(() => getProductionSeedPasswords({
    ...validSeedPasswords,
    DEFAULT_STUDENT_PASSWORD: validSeedPasswords.DEFAULT_ADMIN_PASSWORD,
  }), /must be different/);
});

test('production seed requires a valid non-demo initial admin account', () => {
  assert.deepEqual(getProductionAdminConfig(validAdminConfig), {
    username: 'portal-admin',
    email: 'portal-admin@college.test',
    name: 'College Portal Administrator',
  });
  assert.throws(() => getProductionAdminConfig({
    ...validAdminConfig,
    INITIAL_ADMIN_EMAIL: 'admin@ssipmt.com',
  }), /development demo account/);
  assert.throws(() => getProductionAdminConfig({
    ...validAdminConfig,
    INITIAL_ADMIN_USERNAME: 'admin with spaces',
  }), /INITIAL_ADMIN_USERNAME/);
  assert.throws(() => getProductionAdminConfig({
    ...validAdminConfig,
    INITIAL_ADMIN_NAME: 'CHANGE_ME_initial_admin_name',
  }), /INITIAL_ADMIN_NAME/);
});

test('production runtime rejects a database containing development seed accounts', () => {
  const db = createDatabase(':memory:');
  try {
    assert.doesNotThrow(() => assertNoDemoSeedAccounts(db));
    const departmentId = db.prepare("INSERT INTO departments(name, code) VALUES ('Test', 'TEST')").run().lastInsertRowid;
    db.prepare(`INSERT INTO users(username, email, full_name, role, password_hash, department_id)
      VALUES ('admin', 'admin@ssipmt.com', 'Demo Admin', 'Admin', 'hash', ?)`).run(departmentId);
    assert.throws(() => assertNoDemoSeedAccounts(db), /development demo accounts/);
  } finally {
    db.close();
  }
});

test('production seed creates its administrator and registration catalog without demo accounts', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-college-seed-'));
  const databasePath = path.join(tempDir, 'production.sqlite');
  const backendDir = path.resolve(__dirname, '..');
  try {
    const result = spawnSync(process.execPath, ['src/database/seed.js'], {
      cwd: backendDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
        DATABASE_PATH: databasePath,
        JWT_SECRET: validRuntimeConfig.JWT_SECRET,
        CORS_ORIGIN: 'https://portal.university.test',
        OTP_DELIVERY_PROVIDER: 'webhook',
        OTP_DELIVERY_URL: 'https://otp.university.test/deliver',
        ...validSeedPasswords,
        ...validAdminConfig,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const db = createDatabase(databasePath);
    try {
      const users = db.prepare('SELECT username, email, role FROM users').all();
      assert.deepEqual(users, [{
        username: validAdminConfig.INITIAL_ADMIN_USERNAME,
        email: validAdminConfig.INITIAL_ADMIN_EMAIL,
        role: 'Admin',
      }]);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM departments').get().count, 5);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM branches').get().count, 6);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM semesters').get().count, 8);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sections').get().count, 49);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attendance').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marks').get().count, 0);
      assert.doesNotThrow(() => assertNoDemoSeedAccounts(db));
    } finally {
      db.close();
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
