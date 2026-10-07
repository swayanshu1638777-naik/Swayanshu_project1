const express = require('express');
const { allowRoles } = require('../middleware/auth');
const { HttpError } = require('../utils/http');

const router = express.Router();

function attendanceSummary(db, studentId) {
  return db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN ('Present', 'Late') THEN 1 ELSE 0 END) AS attended,
      ROUND(100.0 * SUM(CASE WHEN status IN ('Present', 'Late') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS percentage
    FROM attendance WHERE student_id = ?
  `).get(studentId);
}

function studentDashboard(db, userId) {
  const attendance = attendanceSummary(db, userId);
  const marks = db.prepare(`
    SELECT COUNT(*) AS assessments,
      ROUND(100.0 * SUM(m.score) / NULLIF(SUM(a.max_marks), 0), 2) AS percentage
    FROM marks m JOIN assessments a ON a.id = m.assessment_id
    WHERE m.student_id = ?
  `).get(userId);
  const bySubject = db.prepare(`
    SELECT s.code, s.name AS subject, COUNT(DISTINCT a.id) AS assessments,
      ROUND(100.0 * SUM(m.score) / NULLIF(SUM(a.max_marks), 0), 2) AS percentage
    FROM marks m JOIN assessments a ON a.id = m.assessment_id
      JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN subjects s ON s.id = ta.subject_id
    WHERE m.student_id = ? GROUP BY s.id ORDER BY s.name
  `).all(userId);
  const recentAttendance = db.prepare(`
    SELECT a.attendance_date AS date, a.status, s.code AS subject_code, s.name AS subject
    FROM attendance a JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN subjects s ON s.id = ta.subject_id
    WHERE a.student_id = ? ORDER BY a.attendance_date DESC LIMIT 10
  `).all(userId);
  return { attendance, marks, bySubject, recentAttendance };
}

function adminDashboard(db) {
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'Student' AND is_active = 1) AS students,
      (SELECT COUNT(*) FROM users WHERE role = 'Teacher' AND is_active = 1) AS teachers,
      (SELECT COUNT(*) FROM departments) AS departments,
      (SELECT COUNT(*) FROM branches) AS branches,
      (SELECT ROUND(100.0 * SUM(CASE WHEN status IN ('Present', 'Late') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) FROM attendance) AS attendance_percentage
  `).get();
  const perStudentAttendance = db.prepare(`
    SELECT student_id, ROUND(100.0 * SUM(CASE WHEN status IN ('Present', 'Late') THEN 1 ELSE 0 END) / COUNT(*), 2) AS percentage
    FROM attendance GROUP BY student_id
  `).all();
  const perStudentMarks = db.prepare(`
    SELECT m.student_id, ROUND(100.0 * SUM(m.score) / NULLIF(SUM(a.max_marks), 0), 2) AS percentage
    FROM marks m JOIN assessments a ON a.id = m.assessment_id GROUP BY m.student_id
  `).all();
  const attendanceMap = new Map(perStudentAttendance.map((row) => [row.student_id, row.percentage]));
  const marksMap = new Map(perStudentMarks.map((row) => [row.student_id, row.percentage]));
  const riskStudents = db.prepare(`
    SELECT u.id, u.roll_no, u.full_name AS name, b.name AS branch, sem.name AS semester
    FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN semesters sem ON sem.id = u.semester_id
    WHERE u.role = 'Student' AND u.is_active = 1
    ORDER BY u.roll_no
  `).all().map((student) => ({
    ...student,
    attendance_percentage: attendanceMap.get(student.id) ?? null,
    marks_percentage: marksMap.get(student.id) ?? null,
  })).filter((student) =>
    (student.attendance_percentage !== null && student.attendance_percentage < 75)
    || (student.marks_percentage !== null && student.marks_percentage < 50));
  stats.low_attendance_students = perStudentAttendance.filter((row) => row.percentage < 75).length;
  return {
    stats,
    riskStudents,
    attendanceByDepartment: db.prepare(`
      SELECT d.id, d.name,
        ROUND(100.0 * SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id), 0), 2) AS percentage
      FROM departments d LEFT JOIN users u ON u.department_id = d.id AND u.role = 'Student'
        LEFT JOIN attendance a ON a.student_id = u.id
      GROUP BY d.id ORDER BY d.name
    `).all(),
    attendanceByBranch: db.prepare(`
      SELECT b.id, b.name,
        ROUND(100.0 * SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id), 0), 2) AS percentage
      FROM branches b LEFT JOIN users u ON u.branch_id = b.id AND u.role = 'Student'
        LEFT JOIN attendance a ON a.student_id = u.id
      GROUP BY b.id ORDER BY b.name
    `).all(),
  };
}

function teacherDashboard(db, userId) {
  const assignments = db.prepare(`
    SELECT ta.id AS assignment_id, s.code AS subject_code, s.name AS subject,
      b.name AS branch, sem.name AS semester, sec.name AS section,
      (SELECT COUNT(*) FROM users u WHERE u.role = 'Student' AND u.section_id = ta.section_id AND u.is_active = 1) AS students,
      (SELECT COUNT(DISTINCT attendance_date) FROM attendance a WHERE a.assignment_id = ta.id) AS sessions,
      (SELECT ROUND(100.0 * SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2)
        FROM attendance a WHERE a.assignment_id = ta.id) AS attendance_percentage,
      (SELECT COUNT(*) FROM assessments e WHERE e.assignment_id = ta.id) AS assessments,
      (SELECT ROUND(100.0 * SUM(m.score) / NULLIF(SUM(e.max_marks), 0), 2)
        FROM marks m JOIN assessments e ON e.id = m.assessment_id WHERE e.assignment_id = ta.id) AS average_marks_percentage
    FROM teaching_assignments ta
      JOIN subjects s ON s.id = ta.subject_id
      JOIN sections sec ON sec.id = ta.section_id
      JOIN branches b ON b.id = sec.branch_id
      JOIN semesters sem ON sem.id = sec.semester_id
    WHERE ta.teacher_id = ? ORDER BY s.name, sec.name
  `).all(userId);
  const students = db.prepare(`
    SELECT COUNT(DISTINCT u.id) AS count
    FROM users u JOIN teaching_assignments a ON a.section_id = u.section_id
    WHERE a.teacher_id = ? AND u.role = 'Student' AND u.is_active = 1
  `).get(userId).count;
  return { stats: { assignments: assignments.length, students }, assignments };
}

function threshold(query, key, defaultValue) {
  const value = query[key] == null ? defaultValue : Number(query[key]);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new HttpError(400, `${key} must be between 0 and 100`);
  return value;
}

router.get('/', (req, res) => {
  if (req.user.role === 'Admin') return res.json(adminDashboard(req.db));
  if (req.user.role === 'Teacher') return res.json(teacherDashboard(req.db, req.user.id));
  return res.json(studentDashboard(req.db, req.user.id));
});
router.get('/admin', allowRoles('Admin'), (req, res) => res.json(adminDashboard(req.db)));
router.get('/teacher', allowRoles('Teacher'), (req, res) => res.json(teacherDashboard(req.db, req.user.id)));
router.get('/student', allowRoles('Student'), (req, res) => res.json(studentDashboard(req.db, req.user.id)));

router.get('/reports/attendance', allowRoles('Admin'), (req, res) => {
  const maxAttendance = threshold(req.query, 'below', 75);
  const branchId = req.query.branch_id == null ? null : Number(req.query.branch_id);
  if (branchId !== null && (!Number.isSafeInteger(branchId) || branchId < 1)) throw new HttpError(400, 'branch_id must be a positive integer');
  const data = req.db.prepare(`
    SELECT u.id, u.roll_no, u.full_name AS name, b.name AS branch, sem.name AS semester,
      COUNT(a.id) AS sessions,
      ROUND(100.0 * SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id), 0), 2) AS attendance_percentage
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN semesters sem ON sem.id = u.semester_id
      JOIN attendance a ON a.student_id = u.id
    WHERE u.role = 'Student' AND u.is_active = 1 AND (? IS NULL OR u.branch_id = ?)
    GROUP BY u.id
    HAVING attendance_percentage < ?
    ORDER BY attendance_percentage, u.roll_no
  `).all(branchId, branchId, maxAttendance);
  res.json({ threshold: maxAttendance, data });
});

router.get('/reports/performance', allowRoles('Admin'), (req, res) => {
  const below = threshold(req.query, 'below', 50);
  const branchId = req.query.branch_id == null ? null : Number(req.query.branch_id);
  if (branchId !== null && (!Number.isSafeInteger(branchId) || branchId < 1)) throw new HttpError(400, 'branch_id must be a positive integer');
  const data = req.db.prepare(`
    SELECT u.id, u.roll_no, u.full_name AS name, b.name AS branch, sem.name AS semester,
      COUNT(m.id) AS assessments,
      ROUND(100.0 * SUM(m.score) / NULLIF(SUM(a.max_marks), 0), 2) AS marks_percentage
    FROM users u JOIN marks m ON m.student_id = u.id
      JOIN assessments a ON a.id = m.assessment_id
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN semesters sem ON sem.id = u.semester_id
    WHERE u.role = 'Student' AND u.is_active = 1 AND (? IS NULL OR u.branch_id = ?)
    GROUP BY u.id
    HAVING marks_percentage < ?
    ORDER BY marks_percentage, u.roll_no
  `).all(branchId, branchId, below);
  res.json({ threshold: below, data });
});

module.exports = router;
