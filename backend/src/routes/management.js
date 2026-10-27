const bcrypt = require('bcryptjs');
const express = require('express');
const { allowRoles } = require('../middleware/auth');
const { HttpError, asyncRoute, pagination, positiveId, requiredPassword, requiredText } = require('../utils/http');

const router = express.Router();
router.use(allowRoles('Admin'));

function insertUser(db, body, role) {
  const username = requiredText(body.username || body.roll_no, 'username', 80);
  const name = requiredText(body.name || body.full_name, 'name');
  const email = requiredText(body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'email must be valid');
  const pass = requiredPassword(body.password);
  if (pass.length < 8) throw new HttpError(400, 'password must contain at least 8 characters');
  const phone = body.phone == null || body.phone === '' ? null : body.phone;
  if (phone != null && (typeof phone !== 'string' || !/^\d{10}$/.test(phone))) {
    throw new HttpError(400, 'phone must contain exactly 10 digits');
  }
  const departmentId = positiveId(body.department_id, 'department_id');
  const branchId = body.branch_id == null ? null : positiveId(body.branch_id, 'branch_id');
  const semesterId = body.semester_id == null ? null : positiveId(body.semester_id, 'semester_id');
  const sectionId = body.section_id == null ? null : positiveId(body.section_id, 'section_id');
  const department = db.prepare('SELECT 1 FROM departments WHERE id = ?').get(departmentId);
  if (!department) throw new HttpError(400, 'department_id does not exist');
  if (role === 'Student' && (!branchId || !semesterId || !sectionId)) {
    throw new HttpError(400, 'Students require branch_id, semester_id, and section_id');
  }
  if (branchId && !db.prepare('SELECT 1 FROM branches WHERE id = ? AND department_id = ?').get(branchId, departmentId)) {
    throw new HttpError(400, 'branch_id does not belong to department_id');
  }
  if (sectionId && !db.prepare('SELECT 1 FROM sections WHERE id = ? AND branch_id = ? AND semester_id = ?').get(sectionId, branchId, semesterId)) {
    throw new HttpError(400, 'section_id does not match the selected branch and semester');
  }
  const rollNo = role === 'Student' ? requiredText(body.roll_no || username, 'roll_no', 40) : null;
  const hash = bcrypt.hashSync(pass, 12);
  const result = db.prepare(`
    INSERT INTO users(username, email, roll_no, full_name, role, password_hash, phone,
                      department_id, branch_id, semester_id, section_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, email, rollNo, name, role, hash, phone,
    departmentId, branchId, semesterId, sectionId);
  return db.prepare(`
    SELECT id, username, email, roll_no, full_name AS name, role, phone,
           department_id, branch_id, semester_id, section_id, is_active, created_at
    FROM users WHERE id = ?
  `).get(result.lastInsertRowid);
}

function updateUser(db, id, body, role) {
  const current = db.prepare(`
    SELECT id, username, email, roll_no, full_name AS name, phone, department_id,
           branch_id, semester_id, section_id
    FROM users WHERE id = ? AND role = ?
  `).get(id, role);
  if (!current) throw new HttpError(404, `${role.toLowerCase()} not found`);
  const next = {
    name: body.name == null ? current.name : requiredText(body.name, 'name'),
    email: body.email == null ? current.email : requiredText(body.email, 'email', 254).toLowerCase(),
    phone: body.phone === undefined ? current.phone : body.phone,
    department_id: body.department_id == null ? current.department_id : positiveId(body.department_id, 'department_id'),
    branch_id: body.branch_id === undefined ? current.branch_id : body.branch_id == null ? null : positiveId(body.branch_id, 'branch_id'),
    semester_id: body.semester_id === undefined ? current.semester_id : body.semester_id == null ? null : positiveId(body.semester_id, 'semester_id'),
    section_id: body.section_id === undefined ? current.section_id : body.section_id == null ? null : positiveId(body.section_id, 'section_id'),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new HttpError(400, 'email must be valid');
  if (next.phone === '') next.phone = null;
  if (next.phone != null && (typeof next.phone !== 'string' || !/^\d{10}$/.test(next.phone))) {
    throw new HttpError(400, 'phone must contain exactly 10 digits');
  }
  if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(next.department_id)) throw new HttpError(400, 'department_id does not exist');
  if (role === 'Student' && (!next.branch_id || !next.semester_id || !next.section_id)) {
    throw new HttpError(400, 'Students require branch_id, semester_id, and section_id');
  }
  if (next.branch_id && !db.prepare('SELECT 1 FROM branches WHERE id = ? AND department_id = ?').get(next.branch_id, next.department_id)) {
    throw new HttpError(400, 'branch_id does not belong to department_id');
  }
  if (next.section_id && !db.prepare('SELECT 1 FROM sections WHERE id = ? AND branch_id = ? AND semester_id = ?').get(next.section_id, next.branch_id, next.semester_id)) {
    throw new HttpError(400, 'section_id does not match the selected branch and semester');
  }
  db.prepare(`
    UPDATE users SET full_name = ?, email = ?, phone = ?, department_id = ?,
      branch_id = ?, semester_id = ?, section_id = ? WHERE id = ?
  `).run(next.name, next.email, next.phone, next.department_id, next.branch_id, next.semester_id, next.section_id, id);
  return db.prepare(`
    SELECT id, username, email, roll_no, full_name AS name, role, phone,
      department_id, branch_id, semester_id, section_id, is_active
    FROM users WHERE id = ?
  `).get(id);
}

function registerReferenceCrud(resource, table, fields, references = {}) {
  router.get(`/${resource}`, (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const rows = req.db.prepare(`SELECT * FROM ${table} ORDER BY id LIMIT ? OFFSET ?`).all(limit, offset);
    const total = req.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    res.json({ data: rows, page, limit, total });
  });
  router.post(`/${resource}`, (req, res) => {
    const values = fields.map(([key, max]) => requiredText(req.body[key], key, max));
    for (const [field, refTable] of Object.entries(references)) {
      const id = positiveId(req.body[field], field);
      if (!req.db.prepare(`SELECT 1 FROM ${refTable} WHERE id = ?`).get(id)) throw new HttpError(400, `${field} does not exist`);
      values.push(id);
    }
    const columns = fields.map(([key]) => key).concat(Object.keys(references));
    const placeholders = columns.map((column) => `@${column}`).join(', ');
    const params = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    const result = req.db.prepare(`INSERT INTO ${table}(${columns.join(', ')}) VALUES (${placeholders})`).run(params);
    res.status(201).json(req.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid));
  });
  router.patch(`/${resource}/:id`, (req, res) => {
    const id = positiveId(req.params.id);
    const current = req.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new HttpError(404, `${resource.slice(0, -1)} not found`);
    const columns = fields.map(([key]) => key).concat(Object.keys(references));
    const values = Object.fromEntries(columns.map((column) => [column, current[column]]));
    for (const [key, max] of fields) {
      if (req.body[key] !== undefined) values[key] = requiredText(req.body[key], key, max);
    }
    for (const [field, refTable] of Object.entries(references)) {
      if (req.body[field] !== undefined) {
        values[field] = positiveId(req.body[field], field);
        if (!req.db.prepare(`SELECT 1 FROM ${refTable} WHERE id = ?`).get(values[field])) {
          throw new HttpError(400, `${field} does not exist`);
        }
      }
    }
    req.db.prepare(`UPDATE ${table} SET ${columns.map((column) => `${column} = @${column}`).join(', ')} WHERE id = @id`)
      .run({ ...values, id });
    res.json(req.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  });
  router.delete(`/${resource}/:id`, (req, res) => {
    const id = positiveId(req.params.id);
    const result = req.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (!result.changes) throw new HttpError(404, `${resource.slice(0, -1)} not found`);
    res.status(204).end();
  });
}

registerReferenceCrud('departments', 'departments', [['name', 120], ['code', 30]]);
registerReferenceCrud('branches', 'branches', [['name', 120], ['code', 30]], { department_id: 'departments' });

router.get('/semesters', (req, res) => res.json({ data: req.db.prepare('SELECT * FROM semesters ORDER BY number').all() }));
router.post('/semesters', (req, res) => {
  const number = Number(req.body.number);
  if (!Number.isInteger(number) || number < 1 || number > 12) throw new HttpError(400, 'number must be an integer from 1 to 12');
  const name = requiredText(req.body.name, 'name', 40);
  const result = req.db.prepare('INSERT INTO semesters(number, name) VALUES (?, ?)').run(number, name);
  res.status(201).json(req.db.prepare('SELECT * FROM semesters WHERE id = ?').get(result.lastInsertRowid));
});
router.patch('/semesters/:id', (req, res) => {
  const id = positiveId(req.params.id);
  const current = req.db.prepare('SELECT * FROM semesters WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Semester not found');
  const number = req.body.number === undefined ? current.number : Number(req.body.number);
  const name = req.body.name === undefined ? current.name : requiredText(req.body.name, 'name', 40);
  if (!Number.isInteger(number) || number < 1 || number > 12) throw new HttpError(400, 'number must be an integer from 1 to 12');
  req.db.prepare('UPDATE semesters SET number = ?, name = ? WHERE id = ?').run(number, name, id);
  res.json(req.db.prepare('SELECT * FROM semesters WHERE id = ?').get(id));
});
router.delete('/semesters/:id', (req, res) => {
  const result = req.db.prepare('DELETE FROM semesters WHERE id = ?').run(positiveId(req.params.id));
  if (!result.changes) throw new HttpError(404, 'Semester not found');
  res.status(204).end();
});

router.get('/sections', (req, res) => res.json({
  data: req.db.prepare(`
    SELECT sec.*, b.name AS branch, sem.name AS semester
    FROM sections sec JOIN branches b ON b.id = sec.branch_id
      JOIN semesters sem ON sem.id = sec.semester_id ORDER BY b.name, sem.number, sec.name
  `).all(),
}));
router.post('/sections', (req, res) => {
  const name = requiredText(req.body.name, 'name', 20);
  const branchId = positiveId(req.body.branch_id, 'branch_id');
  const semesterId = positiveId(req.body.semester_id, 'semester_id');
  const result = req.db.prepare('INSERT INTO sections(name, branch_id, semester_id) VALUES (?, ?, ?)').run(name, branchId, semesterId);
  res.status(201).json(req.db.prepare('SELECT * FROM sections WHERE id = ?').get(result.lastInsertRowid));
});
router.patch('/sections/:id', (req, res) => {
  const id = positiveId(req.params.id);
  const current = req.db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Section not found');
  const name = req.body.name === undefined ? current.name : requiredText(req.body.name, 'name', 20);
  const branchId = req.body.branch_id === undefined ? current.branch_id : positiveId(req.body.branch_id, 'branch_id');
  const semesterId = req.body.semester_id === undefined ? current.semester_id : positiveId(req.body.semester_id, 'semester_id');
  req.db.prepare('UPDATE sections SET name = ?, branch_id = ?, semester_id = ? WHERE id = ?').run(name, branchId, semesterId, id);
  res.json(req.db.prepare('SELECT * FROM sections WHERE id = ?').get(id));
});
router.delete('/sections/:id', (req, res) => {
  const result = req.db.prepare('DELETE FROM sections WHERE id = ?').run(positiveId(req.params.id));
  if (!result.changes) throw new HttpError(404, 'Section not found');
  res.status(204).end();
});

router.get('/students', (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const filters = ['u.role = ?'];
  const params = ['Student'];
  if (req.query.q) {
    filters.push('(u.full_name LIKE ? OR u.roll_no LIKE ? OR u.email LIKE ?)');
    const q = `%${String(req.query.q).slice(0, 100)}%`;
    params.push(q, q, q);
  }
  if (req.query.branch_id) { filters.push('u.branch_id = ?'); params.push(positiveId(req.query.branch_id, 'branch_id')); }
  if (req.query.semester_id) { filters.push('u.semester_id = ?'); params.push(positiveId(req.query.semester_id, 'semester_id')); }
  const where = filters.join(' AND ');
  const data = req.db.prepare(`
    SELECT u.id, u.username, u.email, u.roll_no, u.full_name AS name, u.phone,
      u.department_id, d.name AS department, u.branch_id, b.name AS branch,
      u.semester_id, s.name AS semester, u.section_id, sec.name AS section, u.is_active
    FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN semesters s ON s.id = u.semester_id
      LEFT JOIN sections sec ON sec.id = u.section_id
    WHERE ${where} ORDER BY u.roll_no LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = req.db.prepare(`SELECT COUNT(*) AS count FROM users u WHERE ${where}`).get(...params).count;
  res.json({ data, page, limit, total });
});
router.post('/students', asyncRoute(async (req, res) => {
  res.status(201).json(insertUser(req.db, req.body, 'Student'));
}));
router.patch('/students/:id', (req, res) => res.json(updateUser(req.db, positiveId(req.params.id), req.body, 'Student')));
router.get('/teachers', (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const data = req.db.prepare(`
    SELECT u.id, u.username, u.email, u.full_name AS name, u.phone,
      u.department_id, d.name AS department, u.is_active
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.role = 'Teacher' ORDER BY u.full_name LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = req.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Teacher'").get().count;
  res.json({ data, page, limit, total });
});
router.post('/teachers', asyncRoute(async (req, res) => {
  res.status(201).json(insertUser(req.db, req.body, 'Teacher'));
}));
router.patch('/teachers/:id', (req, res) => res.json(updateUser(req.db, positiveId(req.params.id), req.body, 'Teacher')));
router.patch('/users/:id/status', (req, res) => {
  const id = positiveId(req.params.id);
  if (typeof req.body.is_active !== 'boolean') throw new HttpError(400, 'is_active must be a boolean');
  const result = req.db.prepare('UPDATE users SET is_active = ? WHERE id = ? AND role != ?').run(
    Number(req.body.is_active), id, 'Admin',
  );
  if (!result.changes) throw new HttpError(404, 'User not found or cannot be deactivated');
  res.json({ id, is_active: req.body.is_active });
});
router.post('/users/:id/password', (req, res) => {
  const id = positiveId(req.params.id);
  const password = requiredPassword(req.body.password);
  if (password.length < 8) throw new HttpError(400, 'password must contain at least 8 characters');
  const result = req.db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND role != 'Admin'")
    .run(bcrypt.hashSync(password, 12), id);
  if (!result.changes) throw new HttpError(404, 'User not found or cannot be reset');
  res.status(204).end();
});

router.get('/subjects', (req, res) => {
  const data = req.db.prepare(`
    SELECT s.*, b.name AS branch, sem.name AS semester
    FROM subjects s JOIN branches b ON b.id = s.branch_id
    JOIN semesters sem ON sem.id = s.semester_id ORDER BY s.code
  `).all();
  res.json({ data });
});
router.post('/subjects', (req, res) => {
  const code = requiredText(req.body.code, 'code', 30).toUpperCase();
  const name = requiredText(req.body.name, 'name', 120);
  const branchId = positiveId(req.body.branch_id, 'branch_id');
  const semesterId = positiveId(req.body.semester_id, 'semester_id');
  const valid = req.db.prepare(`
    SELECT 1 FROM sections WHERE branch_id = ? AND semester_id = ? LIMIT 1
  `).get(branchId, semesterId);
  if (!valid) throw new HttpError(400, 'No section exists for the selected branch and semester');
  const result = req.db.prepare('INSERT INTO subjects(code, name, branch_id, semester_id) VALUES (?, ?, ?, ?)').run(
    code, name, branchId, semesterId,
  );
  res.status(201).json(req.db.prepare('SELECT * FROM subjects WHERE id = ?').get(result.lastInsertRowid));
});
router.patch('/subjects/:id', (req, res) => {
  const id = positiveId(req.params.id);
  const current = req.db.prepare('SELECT * FROM subjects WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Subject not found');
  const code = req.body.code === undefined ? current.code : requiredText(req.body.code, 'code', 30).toUpperCase();
  const name = req.body.name === undefined ? current.name : requiredText(req.body.name, 'name', 120);
  const branchId = req.body.branch_id === undefined ? current.branch_id : positiveId(req.body.branch_id, 'branch_id');
  const semesterId = req.body.semester_id === undefined ? current.semester_id : positiveId(req.body.semester_id, 'semester_id');
  if (!req.db.prepare('SELECT 1 FROM sections WHERE branch_id = ? AND semester_id = ? LIMIT 1').get(branchId, semesterId)) {
    throw new HttpError(400, 'No section exists for the selected branch and semester');
  }
  req.db.prepare('UPDATE subjects SET code = ?, name = ?, branch_id = ?, semester_id = ? WHERE id = ?')
    .run(code, name, branchId, semesterId, id);
  res.json(req.db.prepare('SELECT * FROM subjects WHERE id = ?').get(id));
});
router.delete('/subjects/:id', (req, res) => {
  const result = req.db.prepare('DELETE FROM subjects WHERE id = ?').run(positiveId(req.params.id));
  if (!result.changes) throw new HttpError(404, 'Subject not found');
  res.status(204).end();
});

router.get('/assignments', (req, res) => {
  const data = req.db.prepare(`
    SELECT a.id, a.teacher_id, t.full_name AS teacher, a.subject_id, s.code AS subject_code,
      s.name AS subject, a.section_id, sec.name AS section, b.name AS branch, sem.name AS semester
    FROM teaching_assignments a
      JOIN users t ON t.id = a.teacher_id
      JOIN subjects s ON s.id = a.subject_id
      JOIN sections sec ON sec.id = a.section_id
      JOIN branches b ON b.id = sec.branch_id
      JOIN semesters sem ON sem.id = sec.semester_id
    ORDER BY s.code, sec.name
  `).all();
  res.json({ data });
});
router.post('/assignments', (req, res) => {
  const teacherId = positiveId(req.body.teacher_id, 'teacher_id');
  const subjectId = positiveId(req.body.subject_id, 'subject_id');
  const sectionId = positiveId(req.body.section_id, 'section_id');
  const teacher = req.db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'Teacher' AND is_active = 1").get(teacherId);
  const relation = req.db.prepare(`
    SELECT 1 FROM subjects s JOIN sections sec
      ON sec.branch_id = s.branch_id AND sec.semester_id = s.semester_id
    WHERE s.id = ? AND sec.id = ?
  `).get(subjectId, sectionId);
  if (!teacher) throw new HttpError(400, 'teacher_id must refer to an active teacher');
  if (!relation) throw new HttpError(400, 'Subject and section must belong to the same branch and semester');
  const result = req.db.prepare('INSERT INTO teaching_assignments(teacher_id, subject_id, section_id) VALUES (?, ?, ?)').run(
    teacherId, subjectId, sectionId,
  );
  res.status(201).json(req.db.prepare('SELECT * FROM teaching_assignments WHERE id = ?').get(result.lastInsertRowid));
});
router.delete('/assignments/:id', (req, res) => {
  const result = req.db.prepare('DELETE FROM teaching_assignments WHERE id = ?').run(positiveId(req.params.id));
  if (!result.changes) throw new HttpError(404, 'Assignment not found');
  res.status(204).end();
});

router.get('/catalog', (req, res) => {
  const db = req.db;
  res.json({
    departments: db.prepare('SELECT id, name, code FROM departments ORDER BY name').all(),
    branches: db.prepare('SELECT id, name, code, department_id FROM branches ORDER BY name').all(),
    semesters: db.prepare('SELECT id, number, name FROM semesters ORDER BY number').all(),
    sections: db.prepare('SELECT id, name, branch_id, semester_id FROM sections ORDER BY name').all(),
    subjects: db.prepare('SELECT id, code, name, branch_id, semester_id FROM subjects ORDER BY code').all(),
    teachers: db.prepare("SELECT id, full_name AS name, email FROM users WHERE role = 'Teacher' AND is_active = 1 ORDER BY full_name").all(),
  });
});

module.exports = router;
