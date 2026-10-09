const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const express = require('express');
const { authenticate, signToken } = require('../middleware/auth');
const { createAuthRateLimits } = require('../middleware/requestLimits');
const { deliverOtp } = require('../services/otpDelivery');
const { HttpError, asyncRoute, positiveId, requiredText } = require('../utils/http');

const router = express.Router();
const authRateLimits = createAuthRateLimits();
const publicUserFields = `
  SELECT id, username, email, roll_no, full_name AS name, role, phone,
         department_id, branch_id, semester_id, section_id
`;
const publicUser = `${publicUserFields} FROM users`;

function validateRegistration(body, db) {
  const name = requiredText(body.name, 'name');
  const rollNo = requiredText(body.roll_no, 'roll_no', 40);
  const email = requiredText(body.email, 'email', 254).toLowerCase();
  const phone = requiredText(body.phone, 'phone', 20);
  const password = requiredText(body.password, 'password', 128);
  if (!/^[^\s@]+@ssipmt\.com$/i.test(email)) throw new HttpError(400, 'Registration requires an @ssipmt.com email');
  if (!/^\d{10}$/.test(phone)) throw new HttpError(400, 'phone must contain exactly 10 digits');
  if (password.length < 8) throw new HttpError(400, 'password must contain at least 8 characters');

  const departmentId = positiveId(body.department_id, 'department_id');
  const branchId = positiveId(body.branch_id, 'branch_id');
  const semesterId = positiveId(body.semester_id, 'semester_id');
  const sectionId = positiveId(body.section_id, 'section_id');
  const refs = db.prepare(`
    SELECT b.department_id, s.branch_id, s.semester_id
    FROM branches b JOIN sections s ON s.branch_id = b.id
    WHERE b.id = ? AND s.id = ? AND s.semester_id = ?
  `).get(branchId, sectionId, semesterId);
  if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(departmentId)
      || !refs || refs.department_id !== departmentId) {
    throw new HttpError(400, 'Selected department, branch, semester, or section is invalid');
  }

  return {
    username: rollNo,
    roll_no: rollNo,
    full_name: name,
    email,
    phone,
    department_id: departmentId,
    branch_id: branchId,
    semester_id: semesterId,
    section_id: sectionId,
    password,
  };
}

router.post('/login', authRateLimits.login, asyncRoute(async (req, res) => {
  const identity = requiredText(req.body.identity || req.body.username || req.body.email, 'identity', 254);
  const password = requiredText(req.body.password, 'password', 128);
  const user = req.db.prepare(`
    ${publicUserFields}, password_hash, is_active
    FROM users
    WHERE (username = ? OR email = ? COLLATE NOCASE OR roll_no = ?)
  `).get(identity, identity, identity);
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid credentials');
  }
  if (req.body.role && String(req.body.role).toLowerCase() !== user.role.toLowerCase()) {
    throw new HttpError(401, 'Invalid credentials');
  }
  delete user.password_hash;
  delete user.is_active;
  res.json({ token: signToken(user), user });
}));

router.post('/register', authRateLimits.register, asyncRoute(async (req, res) => {
  const payload = validateRegistration(req.body, req.db);
  const existing = req.db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE OR username = ? OR roll_no = ?').get(
    payload.email, payload.username, payload.roll_no,
  );
  if (existing) throw new HttpError(409, 'An account with this email or roll number already exists');

  const now = Date.now();
  const previous = req.db.prepare('SELECT last_sent_at FROM registration_otps WHERE email = ? COLLATE NOCASE').get(payload.email);
  if (previous && now - previous.last_sent_at < 60000) throw new HttpError(429, 'Wait one minute before requesting another OTP');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = now + (Number(process.env.OTP_EXPIRY_MINUTES) || 10) * 60000;
  payload.password_hash = await bcrypt.hash(payload.password, 12);
  delete payload.password;
  const otpHash = await bcrypt.hash(code, 10);
  req.db.prepare(`
    INSERT INTO registration_otps(email, otp_hash, payload, expires_at, attempts, last_sent_at)
    VALUES (?, ?, ?, ?, 0, ?)
    ON CONFLICT(email) DO UPDATE SET otp_hash = excluded.otp_hash,
      payload = excluded.payload, expires_at = excluded.expires_at, attempts = 0,
      last_sent_at = excluded.last_sent_at
  `).run(payload.email, otpHash, JSON.stringify(payload), expiresAt, now);

  try {
    await deliverOtp(payload, code);
  } catch (error) {
    req.db.prepare('DELETE FROM registration_otps WHERE email = ? COLLATE NOCASE').run(payload.email);
    throw error;
  }
  res.status(202).json({ message: 'OTP sent. Verify the code to activate your student account.', expiresInMinutes: Number(process.env.OTP_EXPIRY_MINUTES) || 10 });
}));

router.post('/verify-otp', authRateLimits.verifyOtp, asyncRoute(async (req, res) => {
  const email = requiredText(req.body.email, 'email', 254).toLowerCase();
  const code = requiredText(req.body.otp || req.body.code, 'otp', 6);
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'otp must be a 6-digit code');
  const challenge = req.db.prepare('SELECT * FROM registration_otps WHERE email = ? COLLATE NOCASE').get(email);
  if (!challenge) throw new HttpError(400, 'No pending registration was found for this email');
  if (challenge.expires_at <= Date.now()) {
    req.db.prepare('DELETE FROM registration_otps WHERE email = ? COLLATE NOCASE').run(email);
    throw new HttpError(410, 'OTP has expired; request a new code');
  }
  if (challenge.attempts >= 5) {
    req.db.prepare('DELETE FROM registration_otps WHERE email = ? COLLATE NOCASE').run(email);
    throw new HttpError(429, 'Too many incorrect OTP attempts; request a new code');
  }
  const isValid = await bcrypt.compare(code, challenge.otp_hash);
  if (!isValid) {
    req.db.prepare('UPDATE registration_otps SET attempts = attempts + 1 WHERE email = ? COLLATE NOCASE').run(email);
    throw new HttpError(400, 'Invalid OTP');
  }

  const payload = JSON.parse(challenge.payload);
  const createUser = req.db.transaction(() => {
    const result = req.db.prepare(`
      INSERT INTO users(username, email, roll_no, full_name, role, password_hash, phone,
                        department_id, branch_id, semester_id, section_id)
      VALUES (@username, @email, @roll_no, @full_name, 'Student', @password_hash, @phone,
              @department_id, @branch_id, @semester_id, @section_id)
    `).run(payload);
    req.db.prepare('DELETE FROM registration_otps WHERE email = ? COLLATE NOCASE').run(email);
    return req.db.prepare(`${publicUser} WHERE id = ?`).get(result.lastInsertRowid);
  });
  const user = createUser();
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/change-password',
  (req, res, next) => authenticate(req.db)(req, res, next),
  asyncRoute(async (req, res) => {
    const currentPassword = requiredText(req.body.current_password, 'current_password', 128);
    const newPassword = requiredText(req.body.new_password, 'new_password', 128);
    if (newPassword.length < 8) throw new HttpError(400, 'new_password must contain at least 8 characters');
    const user = req.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) throw new HttpError(401, 'Current password is incorrect');
    if (await bcrypt.compare(newPassword, user.password_hash)) throw new HttpError(400, 'New password must be different from the current password');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    req.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.user.id);
    res.json({ message: 'Password changed successfully' });
  }),
);

router.get('/me', (req, res, next) => authenticate(req.db)(req, res, next), (req, res) => res.json({ user: req.user }));

module.exports = router;
