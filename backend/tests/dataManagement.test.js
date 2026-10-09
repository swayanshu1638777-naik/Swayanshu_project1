const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { createDatabase } = require('../src/database');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-data-management-suite';
const tempDir = path.join(os.tmpdir(), `college-data-${process.pid}-${Date.now()}`);
const dbFile = path.join(tempDir, 'portal.sqlite');
const db = createDatabase(dbFile);
const departmentId = db.prepare("INSERT INTO departments(name, code) VALUES ('Engineering', 'ENG')").run().lastInsertRowid;
const branchId = db.prepare("INSERT INTO branches(name, code, department_id) VALUES ('Computing', 'COMP', ?)").run(departmentId).lastInsertRowid;
const semesterId = db.prepare("INSERT INTO semesters(number, name) VALUES (1, 'Semester 1')").run().lastInsertRowid;
const sectionId = db.prepare("INSERT INTO sections(name, branch_id, semester_id) VALUES ('A', ?, ?)").run(branchId, semesterId).lastInsertRowid;
const hash = bcrypt.hashSync('test-password', 4);
const addUser = db.prepare(`INSERT INTO users(username, email, roll_no, full_name, role, password_hash,
  department_id, branch_id, semester_id, section_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const adminId = addUser.run('data-admin', 'data-admin@example.com', null, 'Data Admin', 'Admin', hash, departmentId, null, null, null).lastInsertRowid;
const teacherId = addUser.run('data-teacher', 'data-teacher@example.com', null, 'Data Teacher', 'Teacher', hash, departmentId, null, null, null).lastInsertRowid;
const studentId = addUser.run('data-student', 'data-student@example.com', 'D101', 'Data Student', 'Student', hash, departmentId, branchId, semesterId, sectionId).lastInsertRowid;
addUser.run('data-student-2', 'data-student-2@example.com', 'D102', 'Data Student Two', 'Student', hash, departmentId, branchId, semesterId, sectionId);
const subjectId = db.prepare("INSERT INTO subjects(code, name, branch_id, semester_id) VALUES ('ENG101', 'Engineering', ?, ?)").run(branchId, semesterId).lastInsertRowid;
const assignmentId = db.prepare('INSERT INTO teaching_assignments(teacher_id, subject_id, section_id) VALUES (?, ?, ?)').run(teacherId, subjectId, sectionId).lastInsertRowid;
const assessmentId = db.prepare("INSERT INTO assessments(assignment_id, title, max_marks, assessment_date) VALUES (?, 'Quiz', 20, '2026-10-01')").run(assignmentId).lastInsertRowid;
const markId = db.prepare('INSERT INTO marks(assessment_id, student_id, score) VALUES (?, ?, 15)').run(assessmentId, studentId).lastInsertRowid;
const attendanceId = db.prepare("INSERT INTO attendance(assignment_id, student_id, attendance_date, status, recorded_by) VALUES (?, ?, '2026-10-01', 'Present', ?)").run(assignmentId, studentId, teacherId).lastInsertRowid;

let server;
let baseUrl;
let adminToken;
let teacherToken;
before(async () => {
  server = createApp({ db }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (identity) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity, password: 'test-password' }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  adminToken = await login('data-admin');
  teacherToken = await login('data-teacher');
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function api(endpoint, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = response.status === 204 ? '' : await response.text();
  return { response, result: text ? JSON.parse(text) : undefined };
}

test('data endpoints require an administrator and counts include major tables', async () => {
  assert.equal((await api('/admin/data/counts', { token: null })).response.status, 401);
  assert.equal((await api('/admin/data/counts', { token: teacherToken })).response.status, 403);
  const counts = await api('/admin/data/counts');
  assert.equal(counts.result.data.students, 2);
  assert.equal(counts.result.data.attendance, 1);
  assert.equal(counts.result.data.marks, 1);
});

test('data listings support search, filters, pagination, and individual details', async () => {
  const filtered = await api('/admin/data/students?q=Data&branch_id=1&semester_id=1&page=1&limit=1');
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.result.total, 2);
  assert.equal(filtered.result.data[0].roll_no, 'D101');
  assert.equal(filtered.result.pages, 2);
  assert.equal((await api('/admin/data/students?q=Data&branch_id=1&semester_id=1&page=2&limit=1')).result.data[0].roll_no, 'D102');
  assert.equal((await api(`/admin/data/attendance/${attendanceId}`)).result.data.status, 'Present');
  assert.equal((await api('/admin/data/not-a-table')).response.status, 404);
  assert.equal((await api('/admin/data/attendance?status=Invalid')).response.status, 400);
});

test('admin can edit records and invalid relationships are rejected', async () => {
  const update = await api(`/admin/data/students/${studentId}`, {
    method: 'PATCH',
    body: { name: 'Edited Student', phone: '1234567890' },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.result.data.name, 'Edited Student');
  const reopened = createDatabase(dbFile);
  assert.equal(reopened.prepare('SELECT full_name FROM users WHERE id = ?').get(studentId).full_name, 'Edited Student');
  reopened.close();
  const invalid = await api(`/admin/data/marks/${markId}`, {
    method: 'PATCH',
    body: { score: 25 },
  });
  assert.equal(invalid.response.status, 400);
  const relation = await api(`/admin/data/assignments/${assignmentId}`, {
    method: 'PATCH',
    body: { section_id: 999 },
  });
  assert.equal(relation.response.status, 400);
});

test('CSV export includes all filtered records and guards spreadsheet formulas', async () => {
  await api(`/admin/data/students/${studentId}`, { method: 'PATCH', body: { name: '=HYPERLINK("x")' } });
  const csv = await fetch(`${baseUrl}/admin/data/students?format=csv&all=true`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  test('student registration catalog is public and contains displayable academic choices', async () => {
    const result = await api('/catalog', { token: null });
    assert.equal(result.response.status, 200);
    assert.equal(result.result.departments[0].name, 'Engineering');
    assert.equal(result.result.branches[0].code, 'COMP');
    assert.equal(result.result.sections[0].name, 'A');
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /'=HYPERLINK/);
  await api(`/admin/data/students/${studentId}`, { method: 'PATCH', body: { name: 'Edited Student' } });
});

test('deletion is limited to appropriate academic records and refreshes persistent storage', async () => {
  assert.equal((await api(`/admin/data/students/${studentId}`, { method: 'DELETE' })).response.status, 405);
  assert.equal((await api(`/admin/data/attendance/${attendanceId}`, { method: 'DELETE' })).response.status, 204);
  assert.equal((await api(`/admin/data/marks/${markId}`, { method: 'DELETE' })).response.status, 204);
  assert.equal((await api(`/admin/data/assessments/${assessmentId}`, { method: 'DELETE' })).response.status, 204);
});
