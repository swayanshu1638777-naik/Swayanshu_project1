const express = require('express');
const { allowRoles } = require('../middleware/auth');
const { HttpError, isValidDate, positiveId, requiredText } = require('../utils/http');

const router = express.Router();
router.use(allowRoles('Admin'));

const resources = {
  students: {
    table: 'users',
    id: 'u.id',
    from: `users u
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN semesters s ON s.id = u.semester_id
      LEFT JOIN sections sec ON sec.id = u.section_id`,
    select: `u.id, u.username, u.roll_no, u.full_name AS name, u.email, u.phone,
      d.name AS department, b.name AS branch, s.name AS semester, sec.name AS section,
      u.department_id, u.branch_id, u.semester_id, u.section_id, u.is_active, u.created_at`,
    search: ['u.full_name', 'u.roll_no', 'u.email', 'u.username'],
    branch: 'u.branch_id',
    semester: 'u.semester_id',
    role: 'Student',
    order: 'u.roll_no, u.id',
    editable: {
      name: ['full_name', 'text'], email: ['email', 'email'], phone: ['phone', 'phone'],
      department_id: ['department_id', 'id'], branch_id: ['branch_id', 'nullableId'],
      semester_id: ['semester_id', 'nullableId'], section_id: ['section_id', 'nullableId'],
      is_active: ['is_active', 'boolean'],
    },
  },
  teachers: {
    table: 'users', id: 'u.id',
    from: `users u LEFT JOIN departments d ON d.id = u.department_id`,
    select: `u.id, u.username, u.full_name AS name, u.email, u.phone, d.name AS department,
      u.department_id, u.is_active, u.created_at`,
    search: ['u.full_name', 'u.email', 'u.username'], role: 'Teacher', order: 'u.full_name, u.id',
    editable: {
      name: ['full_name', 'text'], email: ['email', 'email'], phone: ['phone', 'phone'],
      department_id: ['department_id', 'id'], is_active: ['is_active', 'boolean'],
    },
  },
  departments: {
    table: 'departments', id: 'id', from: 'departments', select: 'id, name, code, created_at',
    search: ['name', 'code'], order: 'name, id',
    editable: { name: ['name', 'text'], code: ['code', 'code'] },
  },
  branches: {
    table: 'branches', id: 'b.id',
    from: 'branches b JOIN departments d ON d.id = b.department_id',
    select: 'b.id, b.name, b.code, b.department_id, d.name AS department, b.created_at',
    search: ['b.name', 'b.code', 'd.name'], branch: 'b.id', order: 'd.name, b.name, b.id',
    editable: { name: ['name', 'text'], code: ['code', 'code'], department_id: ['department_id', 'id'] },
  },
  semesters: {
    table: 'semesters', id: 'id', from: 'semesters', select: 'id, number, name',
    search: ['name'], order: 'number, id',
    editable: { name: ['name', 'text'], number: ['number', 'semester'] },
  },
  sections: {
    table: 'sections', id: 'sec.id',
    from: `sections sec JOIN branches b ON b.id = sec.branch_id
      JOIN semesters s ON s.id = sec.semester_id`,
    select: 'sec.id, sec.name, sec.branch_id, b.name AS branch, b.code AS branch_code, sec.semester_id, s.name AS semester',
    search: ['sec.name', 'b.name', 'b.code', 's.name'], branch: 'sec.branch_id',
    semester: 'sec.semester_id', order: 'b.name, s.number, sec.name, sec.id',
    editable: {
      name: ['name', 'text'], branch_id: ['branch_id', 'id'], semester_id: ['semester_id', 'id'],
    },
  },
  subjects: {
    table: 'subjects', id: 's.id',
    from: `subjects s JOIN branches b ON b.id = s.branch_id
      JOIN semesters sem ON sem.id = s.semester_id`,
    select: 's.id, s.code, s.name, s.branch_id, b.name AS branch, s.semester_id, sem.name AS semester, s.created_at',
    search: ['s.code', 's.name', 'b.name', 'sem.name'], branch: 's.branch_id',
    semester: 's.semester_id', order: 's.code, s.id',
    editable: {
      code: ['code', 'code'], name: ['name', 'text'], branch_id: ['branch_id', 'id'],
      semester_id: ['semester_id', 'id'],
    },
  },
  assignments: {
    table: 'teaching_assignments', id: 'ta.id',
    from: `teaching_assignments ta JOIN users u ON u.id = ta.teacher_id
      JOIN subjects sub ON sub.id = ta.subject_id JOIN sections sec ON sec.id = ta.section_id
      JOIN branches b ON b.id = sec.branch_id JOIN semesters sem ON sem.id = sec.semester_id`,
    select: `ta.id, ta.teacher_id, u.full_name AS teacher, ta.subject_id,
      sub.code AS subject_code, sub.name AS subject, ta.section_id, sec.name AS section,
      b.name AS branch, sem.name AS semester, ta.created_at`,
    search: ['u.full_name', 'sub.code', 'sub.name', 'sec.name', 'b.name', 'sem.name'],
    branch: 'sec.branch_id', semester: 'sec.semester_id', order: 'sub.code, b.name, sem.number, sec.name, ta.id',
    editable: {
      teacher_id: ['teacher_id', 'teacherId'], subject_id: ['subject_id', 'subjectId'],
      section_id: ['section_id', 'sectionId'],
    },
  },
  attendance: {
    table: 'attendance', id: 'a.id',
    from: `attendance a JOIN users u ON u.id = a.student_id
      JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN subjects sub ON sub.id = ta.subject_id JOIN sections sec ON sec.id = ta.section_id
      JOIN branches b ON b.id = sec.branch_id`,
    select: `a.id, a.assignment_id, ta.teacher_id, a.student_id, u.roll_no, u.full_name AS student,
      sub.code AS subject_code, sub.name AS subject, sec.name AS section, b.name AS branch,
      a.attendance_date AS date, a.status, a.recorded_by, a.updated_at`,
    search: ['u.roll_no', 'u.full_name', 'sub.code', 'sub.name', 'b.name'],
    branch: 'sec.branch_id', dateColumn: 'a.attendance_date', order: 'a.attendance_date DESC, u.roll_no, a.id',
    editable: { status: ['status', 'attendanceStatus'], date: ['attendance_date', 'date'] },
    deletable: true,
  },
  assessments: {
    table: 'assessments', id: 'a.id',
    from: `assessments a JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN subjects sub ON sub.id = ta.subject_id JOIN sections sec ON sec.id = ta.section_id
      JOIN branches b ON b.id = sec.branch_id`,
    select: `a.id, a.assignment_id, sub.code AS subject_code, sub.name AS subject,
      sec.name AS section, b.name AS branch, a.title, a.max_marks,
      a.assessment_date AS date, a.created_at`,
    search: ['sub.code', 'sub.name', 'a.title', 'b.name'], branch: 'sec.branch_id',
    dateColumn: 'a.assessment_date', order: 'a.assessment_date DESC, a.title, a.id',
    editable: {
      title: ['title', 'text'], max_marks: ['max_marks', 'maxMarks'],
      date: ['assessment_date', 'date'],
    },
    deletable: true,
  },
  marks: {
    table: 'marks', id: 'm.id',
    from: `marks m JOIN users u ON u.id = m.student_id
      JOIN assessments a ON a.id = m.assessment_id
      JOIN teaching_assignments ta ON ta.id = a.assignment_id
      JOIN subjects sub ON sub.id = ta.subject_id JOIN sections sec ON sec.id = ta.section_id
      JOIN branches b ON b.id = sec.branch_id`,
    select: `m.id, m.assessment_id, m.student_id, u.roll_no, u.full_name AS student,
      sub.code AS subject_code, sub.name AS subject, a.title AS assessment, m.score, a.max_marks,
      a.assessment_date AS date, ROUND(100.0 * m.score / a.max_marks, 2) AS percentage,
      b.name AS branch, m.updated_at`,
    search: ['u.roll_no', 'u.full_name', 'sub.code', 'sub.name', 'a.title', 'b.name'],
    branch: 'sec.branch_id', dateColumn: 'a.assessment_date', order: 'a.assessment_date DESC, u.roll_no, m.id',
    editable: { score: ['score', 'score'] },
    deletable: true,
  },
};

const tableCounts = [
  ['administrators', "SELECT COUNT(*) AS count FROM users WHERE role = 'Admin'"],
  ['students', "SELECT COUNT(*) AS count FROM users WHERE role = 'Student'"],
  ['teachers', "SELECT COUNT(*) AS count FROM users WHERE role = 'Teacher'"],
  ['departments', 'SELECT COUNT(*) AS count FROM departments'],
  ['branches', 'SELECT COUNT(*) AS count FROM branches'],
  ['semesters', 'SELECT COUNT(*) AS count FROM semesters'],
  ['sections', 'SELECT COUNT(*) AS count FROM sections'],
  ['subjects', 'SELECT COUNT(*) AS count FROM subjects'],
  ['assignments', 'SELECT COUNT(*) AS count FROM teaching_assignments'],
  ['attendance', 'SELECT COUNT(*) AS count FROM attendance'],
  ['assessments', 'SELECT COUNT(*) AS count FROM assessments'],
  ['marks', 'SELECT COUNT(*) AS count FROM marks'],
  ['pending registrations', 'SELECT COUNT(*) AS count FROM registration_otps'],
];

function getResource(name) {
  const resource = resources[name];
  if (!resource) throw new HttpError(404, 'Data resource not found');
  return resource;
}

function queryParts(resource, query) {
  const filters = [];
  const params = [];
  if (resource.role) {
    filters.push('u.role = ?');
    params.push(resource.role);
  }
  if (query.q != null && String(query.q).trim()) {
    const term = `%${String(query.q).trim().slice(0, 100)}%`;
    filters.push(`(${resource.search.map((column) => `${column} LIKE ?`).join(' OR ')})`);
    params.push(...resource.search.map(() => term));
  }
  if (query.branch_id != null && query.branch_id !== '') {
    if (!resource.branch) throw new HttpError(400, 'Branch filtering is not supported for this resource');
    filters.push(`${resource.branch} = ?`);
    params.push(positiveId(query.branch_id, 'branch_id'));
  }
  if (query.semester_id != null && query.semester_id !== '') {
    if (!resource.semester) throw new HttpError(400, 'Semester filtering is not supported for this resource');
    filters.push(`${resource.semester} = ?`);
    params.push(positiveId(query.semester_id, 'semester_id'));
  }
  if (query.status != null && query.status !== '') {
    if (resource.table === 'attendance') {
      if (!['Present', 'Absent', 'Late', 'Excused'].includes(query.status)) throw new HttpError(400, 'Invalid attendance status');
      filters.push('a.status = ?');
      params.push(query.status);
    } else if (resource.table === 'users') {
      if (!['active', 'inactive'].includes(query.status)) throw new HttpError(400, 'Invalid account status');
      filters.push('u.is_active = ?');
      params.push(query.status === 'active' ? 1 : 0);
    } else {
      throw new HttpError(400, 'Status filtering is not supported for this resource');
    }
  }
  if (query.date_from || query.date_to) {
    if (!resource.dateColumn) throw new HttpError(400, 'Date filtering is not supported for this resource');
    for (const [name, operator] of [['date_from', '>=' ], ['date_to', '<=']]) {
      if (query[name]) {
        const date = String(query[name]);
        if (!isValidDate(date)) {
          throw new HttpError(400, `${name} must be a valid YYYY-MM-DD date`);
        }
        filters.push(`${resource.dateColumn} ${operator} ?`);
        params.push(date);
      }
    }
  }
  return { where: filters.length ? `WHERE ${filters.join(' AND ')}` : '', params };
}

function listQuery(db, resource, query, { all = false } = {}) {
  const { where, params } = queryParts(resource, query);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM ${resource.from} ${where}`).get(...params).count;
  if (all) {
    return { data: db.prepare(`SELECT ${resource.select} FROM ${resource.from} ${where} ORDER BY ${resource.order}`).all(...params), total };
  }
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1) throw new HttpError(400, 'page must be a positive integer');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'limit must be between 1 and 100');
  const data = db.prepare(`SELECT ${resource.select} FROM ${resource.from} ${where}
    ORDER BY ${resource.order} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  return { data, page, limit, total, pages: Math.ceil(total / limit) };
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseField(db, type, value, field) {
  if (type === 'text' || type === 'code' || type === 'email') {
    const text = requiredText(value, field, type === 'code' ? 40 : type === 'email' ? 254 : 160);
    if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new HttpError(400, `${field} must be a valid email`);
    return type === 'code' ? text.toUpperCase() : type === 'email' ? text.toLowerCase() : text;
  }
  if (type === 'phone') {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{10}$/.test(value)) throw new HttpError(400, `${field} must contain exactly 10 digits`);
    return value;
  }
  if (type === 'id' || type === 'nullableId') {
    if (type === 'nullableId' && (value == null || value === '')) return null;
    return positiveId(value, field);
  }
  if (type === 'boolean') {
    if (value === true || value === 1 || value === '1') return 1;
    if (value === false || value === 0 || value === '0') return 0;
    throw new HttpError(400, `${field} must be a boolean`);
  }
  if (type === 'semester') {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > 12) throw new HttpError(400, 'number must be between 1 and 12');
    return number;
  }
  if (type === 'attendanceStatus') {
    if (!['Present', 'Absent', 'Late', 'Excused'].includes(value)) throw new HttpError(400, 'Invalid attendance status');
    return value;
  }
  if (type === 'date') {
    const date = requiredText(value, field, 10);
    if (!isValidDate(date)) throw new HttpError(400, `${field} must be a valid YYYY-MM-DD date`);
    return date;
  }
  if (type === 'maxMarks' || type === 'score') {
    const number = Number(value);
    if (!Number.isFinite(number) || number < (type === 'score' ? 0 : 0.01) || number > 10000) {
      throw new HttpError(400, `${field} must be between ${type === 'score' ? '0' : '0.01'} and 10000`);
    }
    return number;
  }
  if (type === 'teacherId') {
    const id = positiveId(value, field);
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'Teacher'").get(id)) throw new HttpError(400, 'teacher_id must refer to a teacher');
    return id;
  }
  if (type === 'subjectId') {
    const id = positiveId(value, field);
    if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(id)) throw new HttpError(400, 'subject_id does not exist');
    return id;
  }
  if (type === 'sectionId') {
    const id = positiveId(value, field);
    if (!db.prepare('SELECT 1 FROM sections WHERE id = ?').get(id)) throw new HttpError(400, 'section_id does not exist');
    return id;
  }
  return value;
}

function updateRecord(db, name, id, body) {
  const resource = getResource(name);
  if (!resource.editable) throw new HttpError(405, 'This record type cannot be edited here');
  const current = db.prepare(`SELECT * FROM ${resource.table} WHERE id = ?${resource.role ? ' AND role = ?' : ''}`)
    .get(...(resource.role ? [id, resource.role] : [id]));
  if (!current) throw new HttpError(404, 'Record not found');
  const keys = Object.keys(body).filter((key) => Object.hasOwn(resource.editable, key));
  if (keys.length === 0) throw new HttpError(400, 'Provide at least one supported field to update');
  const values = Object.fromEntries(keys.map((key) => {
    const [column, type] = resource.editable[key];
    return [column, parseField(db, type, body[key], key)];
  }));
  if (name === 'assignments') {
    const teacherId = values.teacher_id ?? current.teacher_id;
    const subjectId = values.subject_id ?? current.subject_id;
    const sectionId = values.section_id ?? current.section_id;
    const relation = db.prepare(`SELECT 1 FROM subjects sub JOIN sections sec
      ON sec.branch_id = sub.branch_id AND sec.semester_id = sub.semester_id
      WHERE sub.id = ? AND sec.id = ?`).get(subjectId, sectionId);
    if (!relation) throw new HttpError(400, 'Subject and section must belong to the same branch and semester');
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'Teacher' AND is_active = 1").get(teacherId)) {
      throw new HttpError(400, 'teacher_id must refer to an active teacher');
    }
  }
  if (name === 'sections') {
    const branchId = values.branch_id ?? current.branch_id;
    const semesterId = values.semester_id ?? current.semester_id;
    if (!db.prepare('SELECT 1 FROM branches WHERE id = ?').get(branchId)
        || !db.prepare('SELECT 1 FROM semesters WHERE id = ?').get(semesterId)) throw new HttpError(400, 'Branch or semester does not exist');
  }
  if (name === 'subjects') {
    const branchId = values.branch_id ?? current.branch_id;
    const semesterId = values.semester_id ?? current.semester_id;
    if (!db.prepare('SELECT 1 FROM branches WHERE id = ?').get(branchId)
        || !db.prepare('SELECT 1 FROM semesters WHERE id = ?').get(semesterId)) throw new HttpError(400, 'Branch or semester does not exist');
    if (!db.prepare('SELECT 1 FROM sections WHERE branch_id = ? AND semester_id = ? LIMIT 1').get(branchId, semesterId)) {
      throw new HttpError(400, 'No section exists for the selected branch and semester');
    }
  }
  if (name === 'students' || name === 'teachers') {
    const departmentId = values.department_id ?? current.department_id;
    const branchId = values.branch_id === undefined ? current.branch_id : values.branch_id;
    const semesterId = values.semester_id === undefined ? current.semester_id : values.semester_id;
    const sectionId = values.section_id === undefined ? current.section_id : values.section_id;
    if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(departmentId)) throw new HttpError(400, 'department_id does not exist');
    if (branchId && !db.prepare('SELECT 1 FROM branches WHERE id = ? AND department_id = ?').get(branchId, departmentId)) {
      throw new HttpError(400, 'branch_id does not belong to department_id');
    }
    if ((name === 'students' && (!branchId || !semesterId || !sectionId))
        || (sectionId && !db.prepare('SELECT 1 FROM sections WHERE id = ? AND branch_id = ? AND semester_id = ?').get(sectionId, branchId, semesterId))) {
      throw new HttpError(400, 'Student enrollment must match a valid branch, semester, and section');
    }
  }
  if (name === 'marks') {
    const assessment = db.prepare('SELECT max_marks FROM assessments WHERE id = ?').get(current.assessment_id);
    if (values.score !== undefined && assessment && values.score > assessment.max_marks) {
      throw new HttpError(400, 'score cannot exceed the assessment maximum');
    }
  }
  if (name === 'assessments') {
    const count = db.prepare('SELECT COUNT(*) AS count FROM marks WHERE assessment_id = ?').get(id).count;
    if (values.max_marks !== undefined
        && db.prepare('SELECT MAX(score) AS maximum FROM marks WHERE assessment_id = ?').get(id).maximum > values.max_marks) {
      throw new HttpError(400, 'max_marks cannot be lower than marks already recorded');
    }
    if (count && values.max_marks !== undefined && values.max_marks <= 0) throw new HttpError(400, 'max_marks must be greater than zero');
  }
  const columns = Object.keys(values);
  db.prepare(`UPDATE ${resource.table} SET ${columns.map((column) => `${column} = @${column}`).join(', ')} WHERE id = @id`)
    .run({ ...values, id });
  return db.prepare(`SELECT ${resource.select} FROM ${resource.from} WHERE ${resource.id} = ?`).get(id);
}

router.get('/counts', (req, res) => {
  const counts = Object.fromEntries(tableCounts.map(([name, sql]) => [name, req.db.prepare(sql).get().count]));
  res.json({ data: counts });
});

router.get('/:resource', (req, res) => {
  const resource = getResource(req.params.resource);
  const result = listQuery(req.db, resource, req.query, { all: req.query.all === 'true' });
  if (req.query.format === 'csv') {
    const columns = req.db.prepare(`SELECT ${resource.select} FROM ${resource.from} LIMIT 0`)
      .columns().map((column) => column.name);
    const csv = [columns.map(csvCell).join(','), ...result.data.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n');
    res.type('text/csv; charset=utf-8');
    res.attachment(`${req.params.resource}.csv`);
    return res.send(`\uFEFF${csv}`);
  }
  return res.json(result);
});

router.get('/:resource/:id', (req, res) => {
  const resource = getResource(req.params.resource);
  const id = positiveId(req.params.id);
  const record = req.db.prepare(`SELECT ${resource.select} FROM ${resource.from} WHERE ${resource.id} = ?`).get(id);
  if (!record) throw new HttpError(404, 'Record not found');
  res.json({ data: record });
});

router.patch('/:resource/:id', (req, res) => {
  res.json({ data: updateRecord(req.db, req.params.resource, positiveId(req.params.id), req.body) });
});

router.delete('/:resource/:id', (req, res) => {
  const resource = getResource(req.params.resource);
  if (!resource.deletable) throw new HttpError(405, 'This record cannot be deleted from Data Management');
  const result = req.db.prepare(`DELETE FROM ${resource.table} WHERE id = ?`).run(positiveId(req.params.id));
  if (!result.changes) throw new HttpError(404, 'Record not found');
  res.status(204).end();
});

module.exports = router;
