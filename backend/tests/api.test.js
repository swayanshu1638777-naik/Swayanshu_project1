const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { createDatabase } = require('../src/database');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-testing';
const db = createDatabase(':memory:');
const department = db.prepare("INSERT INTO departments(name, code) VALUES ('Computer Science', 'CSE')").run().lastInsertRowid;
const branch = db.prepare("INSERT INTO branches(name, code, department_id) VALUES ('AI & ML', 'AIML', ?)").run(department).lastInsertRowid;
const semester = db.prepare("INSERT INTO semesters(number, name) VALUES (3, 'Semester 3')").run().lastInsertRowid;
const section = db.prepare("INSERT INTO sections(name, branch_id, semester_id) VALUES ('A', ?, ?)").run(branch, semester).lastInsertRowid;
const passwordHash = bcrypt.hashSync('password123', 4);
const addUser = db.prepare(`
  INSERT INTO users(username, email, roll_no, full_name, role, password_hash, department_id, branch_id, semester_id, section_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const adminId = addUser.run('admin', 'admin@test.com', null, 'Test Admin', 'Admin', passwordHash, department, null, null, null).lastInsertRowid;
const teacherId = addUser.run('teacher', 'teacher@test.com', null, 'Test Teacher', 'Teacher', passwordHash, department, null, null, null).lastInsertRowid;
const studentId = addUser.run('101', 'student@test.com', '101', 'Test Student', 'Student', passwordHash, department, branch, semester, section).lastInsertRowid;
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
      body: JSON.stringify({ identity, password: 'password123' }),
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
    body: { current_password: 'password123', new_password: 'changed-password-123' },
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
    body: { current_password: 'changed-password-123', new_password: 'password123' },
  });
  assert.equal(restore.response.status, 200);
});

test('role-protected management and class assignments work', async () => {
  const catalog = await api('/admin/catalog');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.result.branches[0].code, 'AIML');
  const denied = await api('/admin/students', { token: teacherToken });
  assert.equal(denied.response.status, 403);
  const roster = await api(`/assignments/${assignment}/roster`, { token: teacherToken });
  assert.equal(roster.response.status, 200);
  assert.equal(roster.result.data[0].roll_no, '101');
  const teacherDashboard = await api('/dashboard', { token: teacherToken });
  assert.equal(teacherDashboard.result.stats.students, 1);
  assert.equal(teacherDashboard.result.assignments[0].average_marks_percentage, null);
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
  const ownMarks = await api('/marks', { token: studentToken });
  assert.equal(ownMarks.result.data[0].percentage, 81);
  const invalidScore = await api(`/assessments/${assessment.result.id}/marks`, {
    token: teacherToken,
    method: 'POST',
    body: { records: [{ student_id: studentId, score: 101 }] },
  });
  assert.equal(invalidScore.response.status, 400);
});

test('student dashboards and admin reports expose computed data', async () => {
  const studentDashboard = await api('/dashboard', { token: studentToken });
  assert.equal(studentDashboard.result.attendance.percentage, 100);
  assert.equal(studentDashboard.result.marks.percentage, 81);
  const report = await api('/dashboard/reports/attendance?below=75');
  assert.equal(report.response.status, 200);
  assert.deepEqual(report.result.data, []);
});

test('admin can update student details and registration completes only after OTP', async () => {
  const update = await api(`/admin/students/${studentId}`, {
    method: 'PATCH',
    body: { phone: '9876543210', name: 'Updated Student' },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.result.name, 'Updated Student');

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
        email: 'new.student@ssipmt.com',
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
  const pending = db.prepare("SELECT payload FROM registration_otps WHERE email = 'new.student@ssipmt.com'").get();
  assert.equal(JSON.parse(pending.payload).password, undefined);
  assert.match(JSON.parse(pending.payload).password_hash, /^\$2[aby]\$/);
  const verified = await api('/auth/verify-otp', {
    token: null,
    method: 'POST',
    body: { email: 'new.student@ssipmt.com', otp: issuedOtp },
  });
  assert.equal(verified.response.status, 201);
  assert.equal(verified.result.user.roll_no, '104');
});
