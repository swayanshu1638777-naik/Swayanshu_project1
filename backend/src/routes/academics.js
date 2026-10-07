const express = require('express');
const { allowRoles } = require('../middleware/auth');
const { HttpError, asyncRoute, positiveId, requiredText } = require('../utils/http');

const router = express.Router();
const attendanceStatuses = new Set(['Present', 'Absent', 'Late', 'Excused']);

function assignmentFor(db, id) {
  const assignment = db.prepare(`
    SELECT a.id, a.teacher_id, a.subject_id, a.section_id, s.code AS subject_code,
      s.name AS subject, sec.name AS section, sec.branch_id, sec.semester_id,
      b.name AS branch, sem.name AS semester, t.full_name AS teacher
    FROM teaching_assignments a
      JOIN subjects s ON s.id = a.subject_id
      JOIN sections sec ON sec.id = a.section_id
      JOIN branches b ON b.id = sec.branch_id
      JOIN semesters sem ON sem.id = sec.semester_id
      JOIN users t ON t.id = a.teacher_id
    WHERE a.id = ?
  `).get(id);
  if (!assignment) throw new HttpError(404, 'Teaching assignment not found');
  return assignment;
}

function canAccessAssignment(req, assignment, allowStudent = false) {
  if (req.user.role === 'Admin') return true;
  if (req.user.role === 'Teacher') {
    if (assignment.teacher_id !== req.user.id) throw new HttpError(403, 'This class is not assigned to you');
    return true;
  }
  if (allowStudent && req.user.role === 'Student' && assignment.section_id === req.user.section_id) return true;
  throw new HttpError(403, 'Insufficient permissions');
}

router.get('/assignments', (req, res) => {
  let where = '';
  const params = [];
  if (req.user.role === 'Teacher') { where = 'WHERE a.teacher_id = ?'; params.push(req.user.id); }
  if (req.user.role === 'Student') { where = 'WHERE a.section_id = ?'; params.push(req.user.section_id); }
  const data = req.db.prepare(`
    SELECT a.id, a.teacher_id, t.full_name AS teacher, a.subject_id, s.code AS subject_code,
      s.name AS subject, a.section_id, sec.name AS section, b.name AS branch, sem.name AS semester
    FROM teaching_assignments a
      JOIN users t ON t.id = a.teacher_id
      JOIN subjects s ON s.id = a.subject_id
      JOIN sections sec ON sec.id = a.section_id
      JOIN branches b ON b.id = sec.branch_id
      JOIN semesters sem ON sem.id = sec.semester_id
    ${where} ORDER BY s.code, sec.name
  `).all(...params);
  res.json({ data });
});

router.get('/assignments/:id/roster', (req, res) => {
  const assignment = assignmentFor(req.db, positiveId(req.params.id));
  canAccessAssignment(req, assignment, true);
  const data = req.db.prepare(`
    SELECT id AS student_id, roll_no, full_name AS name, email
    FROM users WHERE role = 'Student' AND section_id = ? AND is_active = 1
    ORDER BY roll_no
  `).all(assignment.section_id);
  res.json({ assignment, data });
});

router.get('/attendance', (req, res) => {
  const filters = [];
  const params = [];
  if (req.user.role === 'Student') {
    filters.push('a.student_id = ?'); params.push(req.user.id);
  } else if (req.user.role === 'Teacher') {
    filters.push('ta.teacher_id = ?'); params.push(req.user.id);
  } else if (req.query.student_id) {
    filters.push('a.student_id = ?'); params.push(positiveId(req.query.student_id, 'student_id'));
  }
  if (req.query.assignment_id) {
    filters.push('a.assignment_id = ?'); params.push(positiveId(req.query.assignment_id, 'assignment_id'));
  }
  if (req.query.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date))) throw new HttpError(400, 'date must use YYYY-MM-DD');
    filters.push('a.attendance_date = ?'); params.push(req.query.date);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const data = req.db.prepare(`
    SELECT a.id, a.assignment_id, a.student_id, u.roll_no, u.full_name AS student,
      s.code AS subject_code, s.name AS subject, a.attendance_date AS date,
      a.status, a.updated_at
    FROM attendance a
      JOIN users u ON u.id = a.student_id
      JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN subjects s ON s.id = ta.subject_id
    ${where} ORDER BY a.attendance_date DESC, u.roll_no
  `).all(...params);
  res.json({ data });
});

router.post('/attendance/bulk', allowRoles('Admin', 'Teacher'), (req, res) => {
  const assignmentId = positiveId(req.body.assignment_id, 'assignment_id');
  const date = requiredText(req.body.date, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  }
  const records = req.body.records;
  if (!Array.isArray(records) || records.length === 0 || records.length > 500) {
    throw new HttpError(400, 'records must contain between 1 and 500 attendance entries');
  }
  const assignment = assignmentFor(req.db, assignmentId);
  canAccessAssignment(req, assignment);
  const seen = new Set();
  for (const record of records) {
    const studentId = positiveId(record.student_id, 'student_id');
    if (seen.has(studentId)) throw new HttpError(400, `student_id ${studentId} occurs more than once`);
    seen.add(studentId);
    if (!attendanceStatuses.has(record.status)) throw new HttpError(400, `Invalid attendance status for student ${studentId}`);
    if (!req.db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'Student' AND section_id = ? AND is_active = 1")
      .get(studentId, assignment.section_id)) {
      throw new HttpError(400, `Student ${studentId} is not an active member of this class`);
    }
  }
  const save = req.db.transaction(() => {
    const upsert = req.db.prepare(`
      INSERT INTO attendance(assignment_id, student_id, attendance_date, status, recorded_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(assignment_id, student_id, attendance_date) DO UPDATE SET
        status = excluded.status, recorded_by = excluded.recorded_by, updated_at = CURRENT_TIMESTAMP
    `);
    for (const record of records) upsert.run(assignmentId, Number(record.student_id), date, record.status, req.user.id);
  });
  save();
  res.json({ message: 'Attendance saved', count: records.length, assignment_id: assignmentId, date });
});

router.post('/assessments', allowRoles('Admin', 'Teacher'), (req, res) => {
  const assignmentId = positiveId(req.body.assignment_id, 'assignment_id');
  const assignment = assignmentFor(req.db, assignmentId);
  canAccessAssignment(req, assignment);
  const title = requiredText(req.body.title, 'title', 120);
  const maxMarks = Number(req.body.max_marks);
  const assessmentDate = requiredText(req.body.assessment_date, 'assessment_date', 10);
  if (!Number.isFinite(maxMarks) || maxMarks <= 0 || maxMarks > 10000) throw new HttpError(400, 'max_marks must be between 0 and 10000');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate) || Number.isNaN(Date.parse(`${assessmentDate}T00:00:00Z`))) {
    throw new HttpError(400, 'assessment_date must be a valid YYYY-MM-DD date');
  }
  const result = req.db.prepare(`
    INSERT INTO assessments(assignment_id, title, max_marks, assessment_date) VALUES (?, ?, ?, ?)
  `).run(assignmentId, title, maxMarks, assessmentDate);
  res.status(201).json(req.db.prepare('SELECT * FROM assessments WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/assessments', (req, res) => {
  const filters = [];
  const params = [];
  if (req.user.role === 'Teacher') { filters.push('ta.teacher_id = ?'); params.push(req.user.id); }
  if (req.user.role === 'Student') { filters.push('ta.section_id = ?'); params.push(req.user.section_id); }
  if (req.query.assignment_id) { filters.push('a.assignment_id = ?'); params.push(positiveId(req.query.assignment_id, 'assignment_id')); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const data = req.db.prepare(`
    SELECT a.*, s.code AS subject_code, s.name AS subject, ta.section_id
    FROM assessments a
      JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN subjects s ON s.id = ta.subject_id
    ${where} ORDER BY a.assessment_date DESC, a.title
  `).all(...params);
  res.json({ data });
});

router.post('/assessments/:id/marks', allowRoles('Admin', 'Teacher'), (req, res) => {
  const assessmentId = positiveId(req.params.id);
  const assessment = req.db.prepare(`
    SELECT a.*, ta.teacher_id, ta.section_id
    FROM assessments a JOIN teaching_assignments ta ON ta.id = a.assignment_id
    WHERE a.id = ?
  `).get(assessmentId);
  if (!assessment) throw new HttpError(404, 'Assessment not found');
  canAccessAssignment(req, { teacher_id: assessment.teacher_id });
  const records = req.body.records;
  if (!Array.isArray(records) || records.length === 0 || records.length > 500) {
    throw new HttpError(400, 'records must contain between 1 and 500 mark entries');
  }
  const seen = new Set();
  for (const record of records) {
    const studentId = positiveId(record.student_id, 'student_id');
    const score = Number(record.score);
    if (seen.has(studentId)) throw new HttpError(400, `student_id ${studentId} occurs more than once`);
    seen.add(studentId);
    if (!Number.isFinite(score) || score < 0 || score > assessment.max_marks) {
      throw new HttpError(400, `score for student ${studentId} must be between 0 and ${assessment.max_marks}`);
    }
    if (!req.db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'Student' AND section_id = ? AND is_active = 1")
      .get(studentId, assessment.section_id)) {
      throw new HttpError(400, `Student ${studentId} is not an active member of this class`);
    }
  }
  const save = req.db.transaction(() => {
    const upsert = req.db.prepare(`
      INSERT INTO marks(assessment_id, student_id, score) VALUES (?, ?, ?)
      ON CONFLICT(assessment_id, student_id) DO UPDATE SET score = excluded.score, updated_at = CURRENT_TIMESTAMP
    `);
    for (const record of records) upsert.run(assessmentId, Number(record.student_id), Number(record.score));
  });
  save();
  res.json({ message: 'Marks saved', assessment_id: assessmentId, count: records.length });
});

router.get('/marks', (req, res) => {
  const filters = [];
  const params = [];
  if (req.user.role === 'Student') { filters.push('m.student_id = ?'); params.push(req.user.id); }
  if (req.user.role === 'Teacher') { filters.push('ta.teacher_id = ?'); params.push(req.user.id); }
  if (req.query.student_id && req.user.role !== 'Student') {
    filters.push('m.student_id = ?'); params.push(positiveId(req.query.student_id, 'student_id'));
  }
  if (req.query.assignment_id) { filters.push('a.assignment_id = ?'); params.push(positiveId(req.query.assignment_id, 'assignment_id')); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const data = req.db.prepare(`
    SELECT m.id, m.student_id, u.roll_no, u.full_name AS student,
      a.id AS assessment_id, a.title AS assessment, a.assessment_date,
      m.score, a.max_marks, ROUND(m.score * 100.0 / a.max_marks, 2) AS percentage,
      s.code AS subject_code, s.name AS subject
    FROM marks m JOIN assessments a ON a.id = m.assessment_id
      JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN users u ON u.id = m.student_id JOIN subjects s ON s.id = ta.subject_id
    ${where} ORDER BY a.assessment_date DESC, u.roll_no
  `).all(...params);
  res.json({ data });
});

router.get('/profile', allowRoles('Student'), (req, res) => {
  const user = req.db.prepare(`
    SELECT u.id, u.username, u.email, u.roll_no, u.full_name AS name, u.phone,
      d.name AS department, b.name AS branch, sem.name AS semester, sec.name AS section
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN semesters sem ON sem.id = u.semester_id
      LEFT JOIN sections sec ON sec.id = u.section_id
    WHERE u.id = ?
  `).get(req.user.id);
  res.json({ user });
});

router.patch('/profile', allowRoles('Student'), (req, res) => {
  const name = req.body.name == null ? req.user.name : requiredText(req.body.name, 'name');
  const phone = req.body.phone == null ? req.user.phone : requiredText(req.body.phone, 'phone', 20);
  if (phone && !/^\d{10}$/.test(phone)) throw new HttpError(400, 'phone must contain exactly 10 digits');
  req.db.prepare('UPDATE users SET full_name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
  res.json({ user: req.db.prepare('SELECT id, username, email, roll_no, full_name AS name, phone FROM users WHERE id = ?').get(req.user.id) });
});

module.exports = router;
