const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { createDatabase } = require('../src/database');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-this-suite';
const db = createDatabase(':memory:');
const department = db.prepare("INSERT INTO departments(name, code) VALUES ('Computer Science', 'CSE')").run().lastInsertRowid;
const branch = db.prepare("INSERT INTO branches(name, code, department_id) VALUES ('AI & ML', 'AIML', ?)").run(department).lastInsertRowid;
const semester = db.prepare("INSERT INTO semesters(number, name) VALUES (3, 'Semester 3')").run().lastInsertRowid;
const section = db.prepare("INSERT INTO sections(name, branch_id, semester_id) VALUES ('A', ?, ?)").run(branch, semester).lastInsertRowid;
const passwordHash = bcrypt.hashSync('test-password-123', 4);
const addUser = db.prepare(`
  INSERT INTO users(username, email, roll_no, full_name, role, password_hash, department_id, branch_id, semester_id, section_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const adminId = addUser.run('admin', 'admin@test.com', null, 'Test Admin', 'Admin', passwordHash, department, null, null, null).lastInsertRowid;
const teacherId = addUser.run('teacher', 'teacher@test.com', null, 'Test Teacher', 'Teacher', passwordHash, department, null, null, null).lastInsertRowid;
const studentId = addUser.run('101', 'student@test.com', '101', 'Test Student', 'Student', passwordHash, department, branch, semester, section).lastInsertRowid;
const legacyPassword = 'x'.repeat(80);
const subject = db.prepare("INSERT INTO subjects(code, name, branch_id, semester_id) VALUES ('CS301', 'Data Structures', ?, ?)").run(branch, semester).lastInsertRowid;
const assignment = db.prepare('INSERT INTO teaching_assignments(teacher_id, subject_id, section_id) VALUES (?, ?, ?)').run(teacherId, subject, section).lastInsertRowid;

let server;
let baseUrl;
let adminToken;
let teacherToken;
let studentToken;
before(async () => {
  server = createApp({ db }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (identity) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity, password: 'test-password-123' }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  adminToken = await login('admin');
  teacherToken = await login('teacher');
  studentToken = await login('101');
});
after(() => {
  server.close();
  db.close();
});

async function api(path, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = response.status === 204 ? undefined : await response.json();
  return { response, result };
}

test('health and login endpoints respond with expected payloads', async () => {
  const health = await api('/health', { token: null });
  assert.equal(health.response.status, 200);
  assert.equal(health.result.status, 'ok');
  const profile = await api('/auth/me', { token: studentToken });
  assert.equal(profile.result.user.role, 'Student');
  const invalid = await api('/admin/catalog', { token: null });
  assert.equal(invalid.response.status, 401);
  const changed = await api('/auth/change-password', {
    token: studentToken,
    method: 'POST',
    body: { current_password: 'test-password-123', new_password: 'changed-password-123' },
  });
  assert.equal(changed.response.status, 200);
  const newLogin = await api('/auth/login', {
    token: null,
    method: 'POST',
    body: { identity: '101', password: 'changed-password-123' },
  });
  assert.equal(newLogin.response.status, 200);
  const restore = await api('/auth/change-password', {
    token: newLogin.result.token,
    method: 'POST',
    body: { current_password: 'changed-password-123', new_password: 'test-password-123' },
  });
  assert.equal(restore.response.status, 200);
});

test('login preserves verification for passwords stored before the bcrypt byte limit', async () => {
  const legacyTeacherId = addUser.run('legacy-teacher', 'legacy.teacher@test.com', null, 'Legacy Teacher', 'Teacher',
    bcrypt.hashSync(legacyPassword, 4), department, null, null, null).lastInsertRowid;
  try {
    const login = await api('/auth/login', {
      token: null,
      method: 'POST',
      body: { identity: 'legacy-teacher', password: legacyPassword },
    });
    assert.equal(login.response.status, 200);
  } finally {
    db.prepare('DELETE FROM users WHERE id = ?').run(legacyTeacherId);
  }
});

test('role-protected management and class assignments work', async () => {
  const catalog = await api('/admin/catalog');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.result.branches[0].code, 'AIML');
  assert.equal(catalog.result.teachers[0].id, teacherId);
  const denied = await api('/admin/students', { token: teacherToken });
  assert.equal(denied.response.status, 403);
  const roster = await api(`/assignments/${assignment}/roster`, { token: teacherToken });
  assert.equal(roster.response.status, 200);
  assert.equal(roster.result.data[0].roll_no, '101');
  const teacherDashboard = await api('/dashboard', { token: teacherToken });
  assert.equal(teacherDashboard.result.stats.students, 1);
  assert.equal(teacherDashboard.result.assignments[0].average_marks_percentage, null);
});

test('admin-created accounts require an explicit password and preserve its whitespace', async () => {
  const missingPassword = await api('/admin/teachers', {
    method: 'POST',
    body: {
      username: 'new-teacher',
      name: 'New Teacher',
      email: 'new.teacher@test.com',
      department_id: department,
    },
  });
  assert.equal(missingPassword.response.status, 400);

  const oversizedPassword = await api('/admin/teachers', {
    method: 'POST',
    body: {
      username: 'new-teacher',
      name: 'New Teacher',
      email: 'new.teacher@test.com',
      department_id: department,
      password: 'x'.repeat(73),
    },
  });
  assert.equal(oversizedPassword.response.status, 400);

  const created = await api('/admin/teachers', {
    method: 'POST',
    body: {
      username: 'new-teacher',
      name: 'New Teacher',
      email: 'new.teacher@test.com',
      department_id: department,
      password: ' secure pass ',
    },
  });
  assert.equal(created.response.status, 201);

  const login = await api('/auth/login', {
    token: null,
    method: 'POST',
    body: { identity: 'new-teacher', password: ' secure pass ' },
  });
  assert.equal(login.response.status, 200);

  const id = created.result.id;
  assert.equal((await api(`/admin/teachers/${id}`, {
    method: 'PATCH',
    body: { name: 'Updated Teacher', phone: '1234567890' },
  })).result.name, 'Updated Teacher');
  assert.equal((await api(`/admin/teachers/${id}`, {
    method: 'PATCH',
    body: { phone: '123' },
  })).response.status, 400);
  assert.equal((await api(`/admin/users/${id}/password`, {
    method: 'POST',
    body: { password: 'short' },
  })).response.status, 400);
  assert.equal((await api(`/admin/users/${adminId}/password`, {
    method: 'POST',
    body: { password: 'replacement-password' },
  })).response.status, 404);
  assert.equal((await api(`/admin/users/${adminId}/status`, {
    method: 'PATCH',
    body: { is_active: false },
  })).response.status, 404);
  assert.equal((await api(`/admin/users/${id}/password`, {
    token: studentToken,
    method: 'POST',
    body: { password: 'replacement-password' },
  })).response.status, 403);
  assert.equal((await api(`/admin/users/${id}/status`, {
    token: null,
    method: 'PATCH',
    body: { is_active: false },
  })).response.status, 401);

  const reset = await api(`/admin/users/${id}/password`, {
    method: 'POST',
    body: { password: 'replacement-password' },
  });
  assert.equal(reset.response.status, 204);
  assert.equal((await api(`/auth/login`, {
    token: null,
    method: 'POST',
    body: { identity: 'new-teacher', password: 'replacement-password' },
  })).response.status, 200);
  assert.equal((await api(`/admin/users/${id}/status`, {
    method: 'PATCH',
    body: { is_active: false },
  })).response.status, 200);
  assert.equal((await api('/auth/login', {
    token: null,
    method: 'POST',
    body: { identity: 'new-teacher', password: 'replacement-password' },
  })).response.status, 401);
  assert.equal((await api(`/admin/users/${id}/status`, {
    method: 'PATCH',
    body: { is_active: true },
  })).response.status, 200);
  assert.equal((await api('/auth/login', {
    token: null,
    method: 'POST',
    body: { identity: 'new-teacher', password: 'replacement-password' },
  })).response.status, 200);
});

test('attendance and marks are validated, persisted, and scoped by identity', async () => {
  const attendance = await api('/attendance/bulk', {
    token: teacherToken,
    method: 'POST',
    body: { assignment_id: assignment, date: '2026-10-01', records: [{ student_id: studentId, status: 'Present' }] },
  });
  assert.equal(attendance.response.status, 200);
  const ownAttendance = await api('/attendance', { token: studentToken });
  assert.equal(ownAttendance.result.data.length, 1);
  const malformedAttendance = await api('/attendance/bulk', {
    token: teacherToken,
    method: 'POST',
    body: { assignment_id: assignment, date: '2026-10-01', records: [null] },
  });
  assert.equal(malformedAttendance.response.status, 400);
  const assessment = await api('/assessments', {
    token: teacherToken,
    method: 'POST',
    body: { assignment_id: assignment, title: 'Midterm', max_marks: 100, assessment_date: '2026-10-02' },
  });
  assert.equal(assessment.response.status, 201);
  const marks = await api(`/assessments/${assessment.result.id}/marks`, {
    token: teacherToken,
    method: 'POST',
    body: { records: [{ student_id: studentId, score: 81 }] },
  });
  assert.equal(marks.response.status, 200);
  const malformedMarks = await api(`/assessments/${assessment.result.id}/marks`, {
    token: teacherToken,
    method: 'POST',
    body: { records: [null] },
  });
  assert.equal(malformedMarks.response.status, 400);
  const ownMarks = await api('/marks', { token: studentToken });
  assert.equal(ownMarks.result.data[0].percentage, 81);
  const invalidScore = await api(`/assessments/${assessment.result.id}/marks`, {
    token: teacherToken,
    method: 'POST',
    body: { records: [{ student_id: studentId, score: 101 }] },
  });
  assert.equal(invalidScore.response.status, 400);
});

test('attendance and assessment endpoints reject impossible calendar dates', async () => {
  const attendance = await api('/attendance/bulk', {
    token: teacherToken,
    method: 'POST',
    body: { assignment_id: assignment, date: '2026-02-30', records: [{ student_id: studentId, status: 'Present' }] },
  });
  assert.equal(attendance.response.status, 400);

  const assessment = await api('/assessments', {
    token: teacherToken,
    method: 'POST',
    body: { assignment_id: assignment, title: 'Invalid date test', max_marks: 10, assessment_date: '2026-02-30' },
  });
  assert.equal(assessment.response.status, 400);

  const attendanceFilter = await api('/attendance?date=2026-02-30', { token: teacherToken });
  assert.equal(attendanceFilter.response.status, 400);

  const filtered = await api('/admin/data/attendance?date_from=2026-02-30');
  assert.equal(filtered.response.status, 400);
});

test('student dashboards and admin reports expose computed data', async () => {
  const studentDashboard = await api('/dashboard', { token: studentToken });
  assert.equal(studentDashboard.result.attendance.percentage, 100);
  assert.equal(studentDashboard.result.marks.percentage, 81);
  const report = await api('/dashboard/reports/attendance?below=75');
  assert.equal(report.response.status, 200);
  assert.deepEqual(report.result.data, []);
});

test('students can clear a phone number from their profile', async () => {
  const cleared = await api('/profile', {
    token: studentToken,
    method: 'PATCH',
    body: { phone: null },
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.result.user.phone, null);
  await api('/profile', {
    token: studentToken,
    method: 'PATCH',
    body: { phone: '9876543210' },
  });
});

test('admin can update student details and registration completes only after OTP', async () => {
  const update = await api(`/admin/students/${studentId}`, {
    method: 'PATCH',
    body: { phone: '9876543210', name: 'Updated Student' },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.result.name, 'Updated Student');
  const clearedPhone = await api(`/admin/data/students/${studentId}`, {
    method: 'PATCH',
    body: { phone: null },
  });
  assert.equal(clearedPhone.response.status, 200);
  assert.equal(clearedPhone.result.data.phone, null);
  const restoredPhone = await api(`/admin/data/students/${studentId}`, {
    method: 'PATCH',
    body: { phone: '9876543210' },
  });
  assert.equal(restoredPhone.result.data.phone, '9876543210');

  const previousInfo = console.info;
  let issuedOtp;
  console.info = (message) => {
    issuedOtp = String(message).match(/: (\d{6})$/)?.[1];
  };
  let registration;
  try {
    registration = await api('/auth/register', {
      token: null,
      method: 'POST',
      body: {
        roll_no: '104',
        name: 'New Student',
        email: 'new.student@gmail.com',
        phone: '9876543213',
        department_id: department,
        branch_id: branch,
        semester_id: semester,
        section_id: section,
        password: 'secure-pass-123',
      },
    });
  } finally {
    console.info = previousInfo;
  }
  assert.equal(registration.response.status, 202);
  assert.match(issuedOtp, /^\d{6}$/);
  const pending = db.prepare("SELECT payload FROM registration_otps WHERE email = 'new.student@gmail.com'").get();
  assert.equal(JSON.parse(pending.payload).password, undefined);
  assert.match(JSON.parse(pending.payload).password_hash, /^\$2[aby]\$/);
  const verified = await api('/auth/verify-otp', {
    token: null,
    method: 'POST',
    body: { email: 'new.student@gmail.com', otp: issuedOtp },
  });
  assert.equal(verified.response.status, 201);
  assert.equal(verified.result.user.roll_no, '104');
});

test('registration accepts other valid email domains but rejects malformed addresses', async () => {
  const invalid = await api('/auth/register', {
    token: null,
    method: 'POST',
    body: {
      roll_no: '105',
      name: 'Invalid Email Student',
      email: 'not-an-email',
      phone: '9876543214',
      department_id: department,
      branch_id: branch,
      semester_id: semester,
      section_id: section,
      password: 'secure-pass-123',
    },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.result.error, 'email must be valid');
});

test('OTP verification rejects expired challenges and enforces the five-attempt limit', async () => {
  const insertChallenge = db.prepare(`
    INSERT INTO registration_otps(email, otp_hash, payload, expires_at, attempts, last_sent_at)
    VALUES (?, ?, '{}', ?, ?, ?)
  `);
  const otpHash = bcrypt.hashSync('123456', 4);
  const expiredEmail = 'expired.student@ssipmt.com';
  insertChallenge.run(expiredEmail, otpHash, Date.now() - 1, 0, Date.now() - 60000);

  const expired = await api('/auth/verify-otp', {
    token: null,
    method: 'POST',
    body: { email: expiredEmail, otp: '123456' },
  });
  assert.equal(expired.response.status, 410);
  assert.equal(db.prepare('SELECT 1 FROM registration_otps WHERE email = ?').get(expiredEmail), undefined);

  const limitedEmail = 'limited.student@ssipmt.com';
  insertChallenge.run(limitedEmail, otpHash, Date.now() + 60000, 0, Date.now());
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const invalid = await api('/auth/verify-otp', {
      token: null,
      method: 'POST',
      body: { email: limitedEmail, otp: '000000' },
    });
    assert.equal(invalid.response.status, 400);
  }
  assert.equal(db.prepare('SELECT attempts FROM registration_otps WHERE email = ?').get(limitedEmail).attempts, 5);

  const exhausted = await api('/auth/verify-otp', {
    token: null,
    method: 'POST',
    body: { email: limitedEmail, otp: '123456' },
  });
  assert.equal(exhausted.response.status, 429);
  assert.equal(db.prepare('SELECT 1 FROM registration_otps WHERE email = ?').get(limitedEmail), undefined);
});
