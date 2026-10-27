require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') });
const bcrypt = require('bcryptjs');
const { getDatabase } = require('./index');
const {
  assertNoDemoSeedAccounts,
  getProductionAdminConfig,
  getProductionSeedPasswords,
  validateProductionRuntimeConfig,
} = require('../utils/productionConfig');

const productionPasswords = process.env.NODE_ENV === 'production'
  ? (() => {
    validateProductionRuntimeConfig(process.env);
    return getProductionSeedPasswords(process.env);
  })()
  : null;
const productionAdmin = productionPasswords ? getProductionAdminConfig(process.env) : null;
const developmentPasswords = productionPasswords || {
  DEFAULT_ADMIN_PASSWORD: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
  DEFAULT_TEACHER_PASSWORD: process.env.DEFAULT_TEACHER_PASSWORD || 'teacher123',
  DEFAULT_STUDENT_PASSWORD: process.env.DEFAULT_STUDENT_PASSWORD || 'student123',
};

function seedAcademicCatalog(db) {
  const departmentRows = [
    ['Computer Science & Engineering', 'CSE_DEPT'],
    ['Electronics & Communication', 'ECE_DEPT'],
    ['Mechanical Engineering', 'ME_DEPT'],
    ['Civil Engineering', 'CE_DEPT'],
  ];
  const addDepartment = db.prepare('INSERT OR IGNORE INTO departments(name, code) VALUES (?, ?)');
  for (const department of departmentRows) addDepartment.run(...department);

  const departments = Object.fromEntries(db.prepare('SELECT id, code FROM departments').all().map((row) => [row.code, row.id]));
  const branches = [
    ['Computer Science', 'CSE', departments.CSE_DEPT],
    ['CSE Artificial Intelligence', 'CSE-AI', departments.CSE_DEPT],
    ['AI & Machine Learning', 'AIML', departments.CSE_DEPT],
    ['Electronics & Communication', 'ECE', departments.ECE_DEPT],
    ['Mechanical Engineering', 'ME', departments.ME_DEPT],
    ['Civil Engineering', 'CE', departments.CE_DEPT],
  ];
  const addBranch = db.prepare('INSERT OR IGNORE INTO branches(name, code, department_id) VALUES (?, ?, ?)');
  for (const branch of branches) addBranch.run(...branch);
  const branchIds = Object.fromEntries(db.prepare('SELECT id, code FROM branches').all().map((row) => [row.code, row.id]));

  const addSemester = db.prepare('INSERT OR IGNORE INTO semesters(number, name) VALUES (?, ?)');
  for (let number = 1; number <= 8; number += 1) addSemester.run(number, `Semester ${number}`);
  const semesterIds = Object.fromEntries(db.prepare('SELECT id, number FROM semesters').all().map((row) => [row.number, row.id]));
  const addSection = db.prepare('INSERT OR IGNORE INTO sections(name, branch_id, semester_id) VALUES (?, ?, ?)');
  const sectionSeed = [
    ['A', 'AIML', 3], ['B', 'AIML', 3], ['A', 'CSE', 1], ['A', 'CSE-AI', 3],
    ['A', 'ECE', 3], ['A', 'ME', 3], ['A', 'CE', 3],
  ];
  for (const [name, branchCode, semesterNumber] of sectionSeed) {
    addSection.run(name, branchIds[branchCode], semesterIds[semesterNumber]);
  }
  for (const branchCode of Object.keys(branchIds)) {
    for (let semesterNumber = 1; semesterNumber <= 8; semesterNumber += 1) {
      addSection.run('A', branchIds[branchCode], semesterIds[semesterNumber]);
    }
  }
}

for (const [key, password] of Object.entries(developmentPasswords)) {
  if (password.length < 8 || password.length > 128 || !password.trim()
      || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error(`${key} must be non-blank, at least 8 characters, and no more than 72 UTF-8 bytes`);
  }
}
const db = getDatabase();
const seed = db.transaction(() => {
  if (productionAdmin) {
    assertNoDemoSeedAccounts(db);
    seedAcademicCatalog(db);
    let department = db.prepare("SELECT id FROM departments WHERE code = 'PORTAL_ADMIN'").get();
    if (!department) {
      const result = db.prepare('INSERT INTO departments(name, code) VALUES (?, ?)').run('Administration', 'PORTAL_ADMIN');
      department = { id: result.lastInsertRowid };
    }
    const existing = db.prepare('SELECT id, username, email, role FROM users WHERE username = ? OR email = ? COLLATE NOCASE')
      .get(productionAdmin.username, productionAdmin.email);
    if (existing) {
      if (existing.username !== productionAdmin.username
          || existing.email.toLowerCase() !== productionAdmin.email
          || existing.role !== 'Admin') {
        throw new Error('Initial administrator username or email conflicts with an existing account');
      }
      return;
    }
    const passwordHash = bcrypt.hashSync(productionPasswords.DEFAULT_ADMIN_PASSWORD, 12);
    db.prepare(`INSERT INTO users(username, email, full_name, role, password_hash, department_id)
      VALUES (?, ?, ?, 'Admin', ?, ?)`)
      .run(productionAdmin.username, productionAdmin.email, productionAdmin.name, passwordHash, department.id);
    return;
  }

  const departmentRows = [
    ['Computer Science & Engineering', 'CSE_DEPT'],
    ['Electronics & Communication', 'ECE_DEPT'],
    ['Mechanical Engineering', 'ME_DEPT'],
    ['Civil Engineering', 'CE_DEPT'],
  ];
  const addDepartment = db.prepare('INSERT OR IGNORE INTO departments(name, code) VALUES (?, ?)');
  for (const department of departmentRows) addDepartment.run(...department);

  const departments = Object.fromEntries(db.prepare('SELECT id, code FROM departments').all().map((row) => [row.code, row.id]));
  const branches = [
    ['Computer Science', 'CSE', departments.CSE_DEPT],
    ['CSE Artificial Intelligence', 'CSE-AI', departments.CSE_DEPT],
    ['AI & Machine Learning', 'AIML', departments.CSE_DEPT],
    ['Electronics & Communication', 'ECE', departments.ECE_DEPT],
    ['Mechanical Engineering', 'ME', departments.ME_DEPT],
    ['Civil Engineering', 'CE', departments.CE_DEPT],
  ];
  const addBranch = db.prepare('INSERT OR IGNORE INTO branches(name, code, department_id) VALUES (?, ?, ?)');
  for (const branch of branches) addBranch.run(...branch);
  const branchIds = Object.fromEntries(db.prepare('SELECT id, code FROM branches').all().map((row) => [row.code, row.id]));

  const addSemester = db.prepare('INSERT OR IGNORE INTO semesters(number, name) VALUES (?, ?)');
  for (let number = 1; number <= 8; number++) addSemester.run(number, `Semester ${number}`);
  const semesterIds = Object.fromEntries(db.prepare('SELECT id, number FROM semesters').all().map((row) => [row.number, row.id]));
  const addSection = db.prepare('INSERT OR IGNORE INTO sections(name, branch_id, semester_id) VALUES (?, ?, ?)');
  const sectionSeed = [
    ['A', 'AIML', 3], ['B', 'AIML', 3], ['A', 'CSE', 1], ['A', 'CSE-AI', 3], ['A', 'ECE', 3], ['A', 'ME', 3], ['A', 'CE', 3],
  ];
  for (const [name, branchCode, semesterNumber] of sectionSeed) {
    addSection.run(name, branchIds[branchCode], semesterIds[semesterNumber]);
  }
  const sectionId = (name, branchCode, semesterNumber) => db.prepare(`
    SELECT id FROM sections WHERE name = ? AND branch_id = ? AND semester_id = ?
  `).get(name, branchIds[branchCode], semesterIds[semesterNumber]).id;

  const addSubject = db.prepare('INSERT OR IGNORE INTO subjects(code, name, branch_id, semester_id) VALUES (?, ?, ?, ?)');
  addSubject.run('CS301', 'Data Structures & Algorithms', branchIds.AIML, semesterIds[3]);
  addSubject.run('CS302', 'Database Management System', branchIds.AIML, semesterIds[3]);
  const adminHash = bcrypt.hashSync(developmentPasswords.DEFAULT_ADMIN_PASSWORD, 12);
  const teacherHash = bcrypt.hashSync(developmentPasswords.DEFAULT_TEACHER_PASSWORD, 12);
  const studentHash = bcrypt.hashSync(developmentPasswords.DEFAULT_STUDENT_PASSWORD, 12);
  const addUser = db.prepare(`
    INSERT OR IGNORE INTO users(username, email, roll_no, full_name, role, password_hash, phone,
                                department_id, branch_id, semester_id, section_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  addUser.run('admin', 'admin@ssipmt.com', null, 'System Administrator', 'Admin', adminHash, null, departments.CSE_DEPT, null, null, null);
  addUser.run('prof.sharma', 'prof.sharma@ssipmt.com', null, 'Prof. Rajesh Sharma', 'Teacher', teacherHash, '9876543201', departments.CSE_DEPT, null, null, null);
  const studentSection = sectionId('A', 'AIML', 3);
  addUser.run('101', 'rahul@ssipmt.com', '101', 'Rahul Kumar', 'Student', studentHash, '9876543210', departments.CSE_DEPT, branchIds.AIML, semesterIds[3], studentSection);
  addUser.run('102', 'aman@ssipmt.com', '102', 'Aman Singh', 'Student', studentHash, '9876543211', departments.CSE_DEPT, branchIds.AIML, semesterIds[3], studentSection);
  addUser.run('103', 'ravi@ssipmt.com', '103', 'Ravi Gupta', 'Student', studentHash, '9876543212', departments.CSE_DEPT, branchIds.AIML, semesterIds[3], studentSection);

  const teacher = db.prepare("SELECT id FROM users WHERE username = 'prof.sharma'").get().id;
  const subjectIds = Object.fromEntries(db.prepare('SELECT id, code FROM subjects').all().map((row) => [row.code, row.id]));
  const addAssignment = db.prepare('INSERT OR IGNORE INTO teaching_assignments(teacher_id, subject_id, section_id) VALUES (?, ?, ?)');
  addAssignment.run(teacher, subjectIds.CS301, studentSection);
  addAssignment.run(teacher, subjectIds.CS302, studentSection);
  const assignmentIds = db.prepare('SELECT id, subject_id FROM teaching_assignments WHERE teacher_id = ?').all(teacher);
  const users = Object.fromEntries(db.prepare("SELECT id, roll_no FROM users WHERE role = 'Student'").all().map((row) => [row.roll_no, row.id]));
  const addAssessment = db.prepare(`
    INSERT OR IGNORE INTO assessments(assignment_id, title, max_marks, assessment_date) VALUES (?, ?, ?, ?)
  `);
  const addAttendance = db.prepare(`
    INSERT OR IGNORE INTO attendance(assignment_id, student_id, attendance_date, status, recorded_by)
    VALUES (?, ?, ?, ?, ?)
  `);
  const addMark = db.prepare('INSERT OR IGNORE INTO marks(assessment_id, student_id, score) VALUES (?, ?, ?)');
  for (const [index, assignment] of assignmentIds.entries()) {
    addAssessment.run(assignment.id, 'Midterm Examination', 100, '2026-08-08');
    addAssessment.run(assignment.id, 'Class Test 1', 20, '2026-08-15');
    const exams = db.prepare(`
      SELECT id, title FROM assessments
      WHERE assignment_id = ?
      ORDER BY assessment_date, id
    `).all(assignment.id);
    const marks = assignment.subject_id === subjectIds.CS301
      ? { '101': [82, 16], '102': [46, 9], '103': [68, 14] }
      : { '101': [78, 15], '102': [48, 10], '103': [67, 13] };
    for (const [roll, scores] of Object.entries(marks)) {
      exams.forEach((exam, examIndex) => addMark.run(exam.id, users[roll], scores[examIndex]));
      for (let day = 1; day <= 5; day++) {
        const status = roll === '102' && day >= 3 ? 'Absent' : (roll === '103' && day === 5 ? 'Absent' : 'Present');
        addAttendance.run(assignment.id, users[roll], `2026-08-${String(day + index * 6).padStart(2, '0')}`, status, teacher);
      }
    }
  }
});

seed();
db.close();
console.info('Database seed completed.');
