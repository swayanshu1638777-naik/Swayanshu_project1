const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  assertNoDemoSeedAccounts,
  getProductionAdminConfig,
  getProductionSeedPasswords,
  validateProductionRuntimeConfig,
} = require('../src/utils/productionConfig');
const { createDatabase } = require('../src/database');

const validSeedPasswords = {
  DEFAULT_ADMIN_PASSWORD: 'admin-password-long',
  DEFAULT_TEACHER_PASSWORD: 'teacher-password-long',
  DEFAULT_STUDENT_PASSWORD: 'student-password-long',
};
const validRuntimeConfig = {
  ...validSeedPasswords,
  JWT_SECRET: '9d5c1a7f3e8b2c6a0f4d9e1b7c3a8f5d',
  CORS_ORIGIN: 'https://portal.example.net,https://admin.example.net',
  OTP_DELIVERY_URL: 'https://otp-provider.example.net/deliver',
};
const validAdminConfig = {
  INITIAL_ADMIN_USERNAME: 'portal-admin',
  INITIAL_ADMIN_EMAIL: 'portal-admin@college.edu',
  INITIAL_ADMIN_NAME: 'College Portal Administrator',
};

test('production runtime accepts strong JWT secret and explicit trusted CORS origins', () => {
  assert.doesNotThrow(() => validateProductionRuntimeConfig(validRuntimeConfig));
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
    email: 'portal-admin@college.edu',
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

test('production seed creates only its configured administrator and no demo accounts', async () => {
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
        DATABASE_PATH: databasePath,
        JWT_SECRET: validRuntimeConfig.JWT_SECRET,
        CORS_ORIGIN: 'https://portal.university.edu',
        OTP_DELIVERY_URL: 'https://otp.university.edu/deliver',
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
