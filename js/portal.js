(function () {
  'use strict';

  const localApiBase = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '8080'
    ? 'http://localhost:5000/api'
    : '/api';
  const API_BASE = (window.COLLEGE_PORTAL_API_BASE
    || localStorage.getItem('collegePortalApiBase')
    || localApiBase).replace(/\/+$/, '');
  const TOKEN_KEY = 'collegePortalToken';
  const USER_KEY = 'collegePortalUser';
  const rolePages = {
    admin: 'Admin',
    student: 'Student',
    teacher: 'Teacher',
  };
  let user = null;
  let catalog = null;
  let currentAssignments = [];
  let currentRoster = [];
  let currentAssessments = [];

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const pageName = location.pathname.split('/').pop().replace(/\.html$/i, '').toLowerCase();
  const pageTitle = (title, subtitle, content) => {
    const main = document.querySelector('.content-body');
    main.style.visibility = 'visible';
    main.innerHTML = `
      <div class="page-header"><div><h1 class="page-title">${esc(title)}</h1>
      <p class="page-subtitle">${esc(subtitle || '')}</p></div></div>
      <div class="portal-message" role="status" aria-live="polite"></div>${content}
      ${user ? `<details class="card portal-security"><summary>Account security · Change password</summary>
        <form data-action="change-password" class="form-grid">
          ${input('Current password', 'current_password', 'password', true)}
          ${input('New password', 'new_password', 'password', true, 'At least 8 characters')}
          ${input('Confirm new password', 'confirm_password', 'password', true)}
          ${submitButton('Change Password')}</form></details>` : ''}`;
  };
  const message = (text, isError) => {
    const target = document.querySelector('.portal-message');
    if (!target) return;
    target.textContent = text || '';
    target.className = `portal-message${isError ? ' error' : ' success'}`;
  };
  const api = async (path, options) => {
    const settings = options || {};
    const headers = { Accept: 'application/json', ...(settings.headers || {}) };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (settings.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: settings.method || 'GET',
        headers,
        ...(settings.body === undefined ? {} : { body: JSON.stringify(settings.body) }),
      });
    } catch (error) {
      throw new Error(`Cannot reach the API at ${API_BASE}. Check that the backend is running and its CORS settings allow this page.`);
    }
    const text = response.status === 204 ? '' : await response.text();
    let result = null;
    if (text) {
      try { result = JSON.parse(text); } catch (error) {
        throw new Error(`The API returned an unreadable response (${response.status}).`);
      }
    }
    if (!response.ok) {
      if (response.status === 401 && token && path !== '/auth/change-password') clearSession();
      throw new Error((result && (result.error || result.message)) || `API request failed (${response.status}).`);
    }
    return result;
  };
  const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };
  const saveSession = (result) => {
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
  };
  const escOptions = (items, value, label, placeholder) => `
    ${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}
    ${(items || []).map((item) => `<option value="${esc(item[value])}">${esc(label(item))}</option>`).join('')}`;
  const select = (label, name, options, required, id) => `
    <div class="form-group"><label class="form-label" for="${esc(id || name)}">${esc(label)}</label>
    <select class="form-select" id="${esc(id || name)}" name="${esc(name)}" ${required ? 'required' : ''}>${options}</select></div>`;
  const input = (label, name, type, required, placeholder, value) => `
    <div class="form-group"><label class="form-label" for="${esc(name)}">${esc(label)}</label>
    <input class="form-control" id="${esc(name)}" name="${esc(name)}" type="${esc(type || 'text')}"
      ${required ? 'required' : ''} placeholder="${esc(placeholder || '')}" value="${esc(value || '')}"></div>`;
  const submitButton = (text) => `<button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> ${esc(text)}</button>`;
  const table = (headers, rows) => `<div class="table-responsive"><table class="table">
    <thead><tr>${headers.map((heading) => `<th>${esc(heading)}</th>`).join('')}</tr></thead>
    <tbody>${rows || '<tr><td colspan="20">No records found.</td></tr>'}</tbody></table></div>`;
  const actionButton = (action, id, label, kind) => `<button type="button" class="btn ${kind || 'btn-secondary'}"
    data-action="${esc(action)}" data-id="${esc(id)}">${esc(label)}</button>`;
  const stat = (label, value, icon) => `<div class="stat-card"><div class="stat-card-top">
    <span class="stat-title">${esc(label)}</span><div class="stat-icon blue"><i class="fa-solid ${esc(icon || 'fa-chart-simple')}"></i></div>
    </div><div class="stat-value">${esc(value == null ? '—' : value)}</div></div>`;
  const asPercent = (value) => value == null ? '—' : `${Number(value).toFixed(2)}%`;
  const dateToday = () => new Date().toISOString().slice(0, 10);
  const assignmentLabel = (item) => `${item.subject} (${item.subject_code}) · ${item.branch} · ${item.semester} · ${item.section}${item.teacher ? ` · ${item.teacher}` : ''}`;
  const assignmentOptions = (items, selected) => (items || []).map((item) =>
    `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(assignmentLabel(item))}</option>`).join('');
  const friendlyDate = (date) => esc(date || '—');

  function updateNavbar() {
    const identity = document.querySelector('.navbar-user > span:last-of-type');
    if (identity && user) identity.textContent = user.role === 'Student'
      ? `${user.name} (${user.roll_no || user.username})`
      : user.name;
    const badge = document.querySelector('.navbar-user .user-badge');
    if (badge && user) badge.textContent = user.role.toUpperCase();
  }

  function loginPage() {
    const form = document.getElementById('loginForm');
    if (!form) return;
    const togglePassword = document.getElementById('togglePassword');
    const passwordField = document.getElementById('password');
    if (togglePassword && passwordField) {
      togglePassword.addEventListener('click', () => {
        const isHidden = passwordField.type === 'password';
        passwordField.type = isHidden ? 'text' : 'password';
        togglePassword.classList.toggle('fa-eye', isHidden);
        togglePassword.classList.toggle('fa-eye-slash', !isHidden);
      });
    }
    const demo = document.querySelector('.demo-credentials');
    if (demo) demo.remove();
    const status = document.createElement('div');
    status.className = 'portal-auth-message';
    status.setAttribute('role', 'status');
    form.after(status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      status.textContent = '';
      try {
        const role = form.elements.role.value;
        const result = await api('/auth/login', {
          method: 'POST',
          body: { identity: form.elements.username.value.trim(), password: form.elements.password.value, role },
        });
        saveSession(result);
        location.href = `${result.user.role.toLowerCase()}_dashboard.html`;
      } catch (error) {
        status.textContent = error.message;
        status.classList.add('error');
        submit.disabled = false;
      }
    });
    const role = new URLSearchParams(location.search).get('role');
    if (['Admin', 'Teacher', 'Student'].includes(role)) form.elements.role.value = role;
  }

  function registrationPage() {
    const form = document.getElementById('regForm');
    if (!form) return;
    const messageNode = document.createElement('div');
    messageNode.className = 'portal-auth-message';
    messageNode.setAttribute('role', 'status');
    form.after(messageNode);
    const catalogInputs = ['department_id', 'branch_id', 'semester_id', 'section_id'];
    catalogInputs.forEach((name) => {
      const control = form.elements[name];
      if (!control) return;
      control.innerHTML = '';
      control.outerHTML = `<input class="styled-input" type="number" min="1" step="1" name="${name}" required>`;
      const replacement = form.elements[name];
      replacement.previousElementSibling && replacement.previousElementSibling.setAttribute('for', name);
      replacement.insertAdjacentHTML('beforebegin', `<small class="form-hint">Enter the ${name.replace('_id', '')} ID provided by your college.</small>`);
    });
    form.elements.password.minLength = 8;
    form.elements.password.placeholder = 'Minimum 8 characters';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.email.toLowerCase().endsWith('@ssipmt.com')) {
        messageNode.textContent = 'Registration requires your @ssipmt.com email address.';
        return;
      }
      if (values.password !== values.confirm_password) {
        messageNode.textContent = 'Passwords do not match.';
        return;
      }
      delete values.confirm_password;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const result = await api('/auth/register', { method: 'POST', body: values });
        sessionStorage.setItem('collegePortalPendingEmail', values.email);
        messageNode.textContent = result.message || 'OTP sent. Check the email/phone delivery configured by your college.';
        location.href = 'verify_otp.html';
      } catch (error) {
        messageNode.textContent = error.message;
        submit.disabled = false;
      }
    });
  }

  function otpPage() {
    const form = document.getElementById('otpForm');
    if (!form) return;
    const banner = document.querySelector('.demo-otp-banner');
    if (banner) banner.remove();
    const email = sessionStorage.getItem('collegePortalPendingEmail') || new URLSearchParams(location.search).get('email') || '';
    const emailNode = document.createElement('p');
    emailNode.textContent = email ? `Verify the code sent for ${email}` : 'Enter the email used for registration and the six-digit code.';
    form.prepend(emailNode);
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.name = 'email';
    emailInput.value = email;
    emailInput.placeholder = 'College email';
    emailInput.required = true;
    emailInput.className = 'styled-input';
    emailInput.style.marginTop = '1rem';
    form.prepend(emailInput);
    const otp = document.getElementById('otp_input');
    otp.value = '';
    otp.name = 'otp';
    otp.inputMode = 'numeric';
    otp.pattern = '[0-9]{6}';
    otp.autocomplete = 'one-time-code';
    const notice = document.createElement('div');
    notice.className = 'portal-auth-message';
    notice.setAttribute('role', 'status');
    form.after(notice);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const result = await api('/auth/verify-otp', {
          method: 'POST',
          body: { email: emailInput.value.trim(), otp: otp.value.trim() },
        });
        sessionStorage.removeItem('collegePortalPendingEmail');
        saveSession(result);
        location.href = 'student_dashboard.html';
      } catch (error) {
        notice.textContent = error.message;
        button.disabled = false;
      }
    });
  }

  async function loadCatalog() {
    if (!catalog) catalog = await api('/admin/catalog');
    return catalog;
  }

  async function adminDashboard() {
    const data = await api('/dashboard/admin');
    const stats = data.stats;
    pageTitle('College Administration Dashboard', 'College-wide attendance, academic performance and risk overview', `
      <div class="stats-grid">${stat('Total Students', stats.students, 'fa-user-graduate')}
        ${stat('Total Teachers', stats.teachers, 'fa-chalkboard-user')}
        ${stat('Departments', stats.departments, 'fa-building-columns')}
        ${stat('Branches', stats.branches, 'fa-code-branch')}
        ${stat('College Attendance', asPercent(stats.attendance_percentage), 'fa-calendar-check')}
        ${stat('Below 75% Attendance', stats.low_attendance_students, 'fa-triangle-exclamation')}</div>
      <section class="card"><div class="card-header"><h3 class="card-title">At-risk students</h3></div>
        ${table(['Roll No', 'Student', 'Branch', 'Semester', 'Attendance', 'Marks', 'Risk'],
          data.riskStudents.map((row) => `<tr><td>${esc(row.roll_no)}</td><td>${esc(row.name)}</td><td>${esc(row.branch)}</td>
            <td>${esc(row.semester)}</td><td>${esc(asPercent(row.attendance_percentage))}</td>
            <td>${esc(asPercent(row.marks_percentage))}</td><td><span class="badge badge-danger">AT RISK</span></td></tr>`).join(''))}</section>
      <div class="form-grid">
        <section class="card"><div class="card-header"><h3 class="card-title">Attendance by department</h3></div>
          ${table(['Department', 'Attendance'], data.attendanceByDepartment.map((row) =>
            `<tr><td>${esc(row.name)}</td><td>${esc(asPercent(row.percentage))}</td></tr>`).join(''))}</section>
        <section class="card"><div class="card-header"><h3 class="card-title">Attendance by branch</h3></div>
          ${table(['Branch', 'Attendance'], data.attendanceByBranch.map((row) =>
            `<tr><td>${esc(row.name)}</td><td>${esc(asPercent(row.percentage))}</td></tr>`).join(''))}</section>
      </div>`);
  }

  async function loadReference(resource) {
    const result = await api(`/admin/${resource}`);
    return result.data || [];
  }

  async function adminReferencePage(resource) {
    const conf = {
      departments: { title: 'Manage College Departments', form: `${input('Department Name', 'name', 'text', true)}${input('Department Code', 'code', 'text', true)}`, headers: ['ID', 'Department', 'Code', 'Actions'] },
      branches: { title: 'Manage College Branches', form: `${select('Department', 'department_id', escOptions(catalog.departments, 'id', (item) => `${item.name} (${item.code})`), true)}${input('Branch Name', 'name', 'text', true)}${input('Branch Code', 'code', 'text', true)}`, headers: ['ID', 'Branch', 'Code', 'Department', 'Actions'] },
      semesters: { title: 'Manage Semesters', form: `${input('Semester Number', 'number', 'number', true)}${input('Semester Name', 'name', 'text', true)}`, headers: ['ID', 'Number', 'Semester', 'Actions'] },
      sections: { title: 'Manage Sections', form: `${input('Section Name', 'name', 'text', true)}${select('Branch', 'branch_id', escOptions(catalog.branches, 'id', (item) => `${item.name} (${item.code})`), true)}${select('Semester', 'semester_id', escOptions(catalog.semesters, 'id', (item) => item.name), true)}`, headers: ['ID', 'Section', 'Branch', 'Semester', 'Actions'] },
      subjects: { title: 'Course & Subject Catalogue', form: `${input('Subject Code', 'code', 'text', true)}${input('Subject Name', 'name', 'text', true)}${select('Branch', 'branch_id', escOptions(catalog.branches, 'id', (item) => `${item.name} (${item.code})`), true)}${select('Semester', 'semester_id', escOptions(catalog.semesters, 'id', (item) => item.name), true)}`, headers: ['ID', 'Code', 'Subject', 'Branch', 'Semester', 'Actions'] },
    }[resource];
    const rows = await loadReference(resource);
    const rowHtml = rows.map((row) => {
      const branchName = resource === 'branches' ? (catalog.departments.find((item) => item.id === row.department_id) || {}).name : row.branch;
      const actions = `${actionButton('edit-reference', row.id, 'Edit')}${actionButton('delete-reference', row.id, 'Delete', 'btn-danger')}`;
      if (resource === 'departments') return `<tr><td>${esc(row.id)}</td><td>${esc(row.name)}</td><td>${esc(row.code)}</td><td>${actions}</td></tr>`;
      if (resource === 'branches') return `<tr><td>${esc(row.id)}</td><td>${esc(row.name)}</td><td>${esc(row.code)}</td><td>${esc(branchName)}</td><td>${actions}</td></tr>`;
      if (resource === 'semesters') return `<tr><td>${esc(row.id)}</td><td>${esc(row.number)}</td><td>${esc(row.name)}</td><td>${actions}</td></tr>`;
      if (resource === 'sections') return `<tr><td>${esc(row.id)}</td><td>${esc(row.name)}</td><td>${esc(row.branch)}</td><td>${esc(row.semester)}</td><td>${actions}</td></tr>`;
      return `<tr><td>${esc(row.id)}</td><td>${esc(row.code)}</td><td>${esc(row.name)}</td><td>${esc(row.branch)}</td><td>${esc(row.semester)}</td><td>${actions}</td></tr>`;
    }).join('');
    const referenceNav = ['departments', 'branches', 'semesters', 'sections', 'subjects'].map((item) =>
      `<a class="btn ${item === resource ? 'btn-primary' : 'btn-secondary'}" href="admin_departments.html?view=${item}">${item[0].toUpperCase()}${item.slice(1)}</a>`).join('');
    pageTitle(conf.title, 'Manage records using the current college catalog.', `
      <nav class="portal-reference-nav" aria-label="Reference data">${referenceNav}</nav>
      <div class="portal-two-column"><section class="card"><div class="card-header"><h3 class="card-title">Add ${esc(resource.slice(0, -1))}</h3></div>
        <form data-action="create-${esc(resource)}">${conf.form}${submitButton('Save')}</form></section>
      <section class="card"><div class="card-header"><h3 class="card-title">Existing ${esc(resource)}</h3></div>
        ${table(conf.headers, rowHtml)}</section></div>`);
  }

  async function adminStudents() {
    const search = new URLSearchParams(location.search);
    const [cat, params] = await Promise.all([
      loadCatalog(),
      Promise.resolve(new URLSearchParams({
        ...(search.get('q') ? { q: search.get('q') } : {}),
        ...(search.get('branch_id') ? { branch_id: search.get('branch_id') } : {}),
        ...(search.get('semester_id') ? { semester_id: search.get('semester_id') } : {}),
      })),
    ]);
    const result = await api(`/admin/students?${params.toString()}`);
    pageTitle('College Student Directory', 'Search, filter, enroll, update, and manage student accounts.', `
      <section class="card"><form data-action="filter-students" class="form-grid">
        ${input('Search name, email or roll number', 'q', 'search', false, 'Search...')}
        ${select('Branch', 'branch_id', escOptions(cat.branches, 'id', (item) => `${item.name} (${item.code})`, 'All branches'), false)}
        ${select('Semester', 'semester_id', escOptions(cat.semesters, 'id', (item) => item.name, 'All semesters'), false)}
        <button class="btn btn-secondary" type="submit">Filter</button></form></section>
      <div class="portal-two-column"><section class="card"><div class="card-header"><h3 class="card-title">Add Student</h3></div>
        <form data-action="create-student">${input('Roll Number', 'roll_no', 'text', true)}
          ${input('Full Name', 'name', 'text', true)}${input('Email', 'email', 'email', true)}
          ${input('Phone', 'phone', 'tel', false)}${input('Password', 'password', 'password', false, 'Minimum 8 characters')}
          ${select('Department', 'department_id', escOptions(cat.departments, 'id', (x) => `${x.name} (${x.code})`), true)}
          ${select('Branch', 'branch_id', escOptions(cat.branches, 'id', (x) => `${x.name} (${x.code})`), true)}
          ${select('Semester', 'semester_id', escOptions(cat.semesters, 'id', (x) => x.name), true)}
          ${select('Section', 'section_id', escOptions(cat.sections, 'id', (x) => {
            const branch = cat.branches.find((b) => b.id === x.branch_id);
            const semester = cat.semesters.find((s) => s.id === x.semester_id);
            return `${branch ? branch.code : ''} ${semester ? semester.name : ''} Section ${x.name}`;
          }), true)}${submitButton('Save Student')}</form></section>
      <section class="card"><div class="card-header"><h3 class="card-title">Students (${esc(result.total)})</h3></div>
        ${table(['Roll No', 'Student', 'Email', 'Branch', 'Semester', 'Section', 'Status', 'Actions'],
          result.data.map((row) => `<tr><td>${esc(row.roll_no)}</td><td>${esc(row.name)}</td><td>${esc(row.email)}</td>
            <td>${esc(row.branch)}</td><td>${esc(row.semester)}</td><td>${esc(row.section)}</td>
            <td>${row.is_active ? 'Active' : 'Inactive'}</td><td>${actionButton('edit-user', row.id, 'Edit')}
            ${actionButton('toggle-user', row.id, row.is_active ? 'Deactivate' : 'Activate', row.is_active ? 'btn-danger' : 'btn-secondary')}
            ${actionButton('reset-password', row.id, 'Reset password')}</td></tr>`).join(''))}</section></div>`);
    const form = document.querySelector('[data-action="filter-students"]');
    if (form) {
      form.elements.q.value = new URLSearchParams(location.search).get('q') || '';
      form.elements.branch_id.value = new URLSearchParams(location.search).get('branch_id') || '';
      form.elements.semester_id.value = new URLSearchParams(location.search).get('semester_id') || '';
    }
  }

  async function adminTeachers() {
    const [cat, result, assignmentResult, teachersResult] = await Promise.all([
      loadCatalog(), api('/admin/teachers'), api('/admin/assignments'),
    ]);
    const teachers = result.data || [];
    pageTitle('Faculty & Teacher Directory', 'Manage faculty, active access, and teaching assignments.', `
      <div class="portal-two-column"><section class="card"><div class="card-header"><h3 class="card-title">Add Faculty</h3></div>
        <form data-action="create-teacher">${input('Username', 'username', 'text', true)}
          ${input('Full Name', 'name', 'text', true)}${input('Email', 'email', 'email', true)}
          ${input('Phone', 'phone', 'tel', false)}${input('Password', 'password', 'password', false, 'Minimum 8 characters')}
          ${select('Department', 'department_id', escOptions(cat.departments, 'id', (x) => `${x.name} (${x.code})`), true)}${submitButton('Save Faculty')}</form></section>
      <section class="card"><div class="card-header"><h3 class="card-title">Faculty Directory</h3></div>
        ${table(['Name', 'Email', 'Department', 'Status', 'Actions'], result.data.map((row) =>
          `<tr><td>${esc(row.name)}</td><td>${esc(row.email)}</td><td>${esc(row.department)}</td><td>${row.is_active ? 'Active' : 'Inactive'}</td>
            <td>${actionButton('edit-user', row.id, 'Edit')}
              ${actionButton('toggle-user', row.id, row.is_active ? 'Deactivate' : 'Activate', row.is_active ? 'btn-danger' : 'btn-secondary')}
              ${actionButton('reset-password', row.id, 'Reset password')}</td></tr>`).join(''))}</section></div>
      <section class="card"><div class="card-header"><h3 class="card-title">Assign Teacher to Class & Subject</h3></div>
        <form data-action="create-assignment" class="form-grid">
          ${select('Teacher', 'teacher_id', escOptions(teachers.filter((t) => t.is_active), 'id', (t) => `${t.name} (${t.email})`), true)}
          ${select('Subject', 'subject_id', escOptions(cat.subjects, 'id', (s) => `${s.code} — ${s.name} (${s.branch_id}/${s.semester_id})`), true)}
          ${select('Section', 'section_id', escOptions(cat.sections, 'id', (s) => {
            const branch = cat.branches.find((b) => b.id === s.branch_id);
            const sem = cat.semesters.find((semItem) => semItem.id === s.semester_id);
            return `${branch ? branch.code : ''} ${sem ? sem.name : ''} Section ${s.name}`;
          }), true)}${submitButton('Assign')}</form>
        ${table(['ID', 'Teacher', 'Subject', 'Branch', 'Semester', 'Section', 'Actions'],
          assignmentResult.data.map((a) => `<tr><td>${esc(a.id)}</td><td>${esc(a.teacher)}</td>
            <td>${esc(`${a.subject_code} — ${a.subject}`)}</td><td>${esc(a.branch)}</td>
            <td>${esc(a.semester)}</td><td>${esc(a.section)}</td><td>${actionButton('delete-assignment', a.id, 'Remove', 'btn-danger')}</td></tr>`).join(''))}</section>`);
  }

  async function adminReports() {
    const cat = await loadCatalog();
    const params = new URLSearchParams(location.search);
    const type = params.get('type') || 'attendance';
    const threshold = params.get('below') || (type === 'attendance' ? '75' : '50');
    const branchId = params.get('branch_id') || '';
    let data = [];
    let errorText = '';
    try {
      const query = new URLSearchParams({ below: threshold, ...(branchId ? { branch_id: branchId } : {}) });
      const result = await api(`/dashboard/reports/${type}?${query}`);
      data = result.data || [];
    } catch (error) { errorText = error.message; }
    const percentField = type === 'attendance' ? 'attendance_percentage' : 'marks_percentage';
    pageTitle('Generate Official Reports', 'Filter the live backend report by metric, threshold and branch.', `
      <section class="card"><form data-action="filter-report" class="form-grid">
        ${select('Report Type', 'type', '<option value="attendance">Low attendance</option><option value="performance">Low marks performance</option>', true)}
        ${input('Below (%)', 'below', 'number', true, '', threshold)}
        ${select('Branch', 'branch_id', escOptions(cat.branches, 'id', (b) => `${b.name} (${b.code})`, 'All branches'), false)}
        <button class="btn btn-primary" type="submit">Generate Report</button>
        <button class="btn btn-secondary" type="button" data-action="print-report">Print</button></form></section>
      ${errorText ? `<p class="portal-error">${esc(errorText)}</p>` : ''}
      <section class="card"><h3 class="card-title">${type === 'attendance' ? 'Attendance report' : 'Academic performance report'} · ${esc(data.length)} records</h3>
        ${table(['Roll No', 'Student', 'Branch', 'Semester', type === 'attendance' ? 'Sessions' : 'Assessments', 'Percentage'],
          data.map((row) => `<tr><td>${esc(row.roll_no)}</td><td>${esc(row.name)}</td><td>${esc(row.branch)}</td>
            <td>${esc(row.semester)}</td><td>${esc(type === 'attendance' ? row.sessions : row.assessments)}</td><td>${esc(asPercent(row[percentField]))}</td></tr>`).join(''))}</section>`);
    const form = document.querySelector('[data-action="filter-report"]');
    form.elements.type.value = type;
    form.elements.branch_id.value = branchId;
  }

  async function studentDashboard() {
    const [data, attendance] = await Promise.all([api('/dashboard/student'), api('/attendance')]);
    const grouped = new Map();
    attendance.data.forEach((record) => {
      const key = `${record.subject_code} · ${record.subject}`;
      const item = grouped.get(key) || { code: record.subject_code, subject: record.subject, total: 0, present: 0 };
      item.total += 1;
      if (record.status === 'Present' || record.status === 'Late') item.present += 1;
      grouped.set(key, item);
    });
    const subjectRows = Array.from(grouped.values()).map((item) => {
      const percentage = item.total ? 100 * item.present / item.total : 0;
      const needed = percentage >= 75 ? 0 : Math.max(0, Math.ceil((0.75 * item.total - item.present) / 0.25));
      return `<tr><td>${esc(item.code)}</td><td>${esc(item.subject)}</td><td>${esc(`${item.present}/${item.total}`)}</td>
        <td>${esc(asPercent(percentage))}</td><td>${esc(percentage >= 75 ? 'On track' : 'Below 75%')}</td>
        <td>${needed ? `Attend next ${needed} class${needed === 1 ? '' : 'es'} to reach 75%` : 'Requirement met'}</td></tr>`;
    }).join('');
    pageTitle(`Welcome, ${user.name}`, `Roll No: ${user.roll_no || user.username} · ${user.role}`, `
      <div class="stats-grid">${stat('Overall Attendance', asPercent(data.attendance.percentage), 'fa-calendar-check')}
        ${stat('Overall Marks', asPercent(data.marks.percentage), 'fa-award')}
        ${stat('Subjects with marks', data.bySubject.length, 'fa-book')}
        ${stat('Recent attendance entries', attendance.data.length, 'fa-list-check')}</div>
      <section class="card"><div class="card-header"><h3 class="card-title">Subject-wise attendance breakdown</h3></div>
        ${table(['Subject Code', 'Subject', 'Present / Total', 'Attendance', 'Standing', '75% Target'],
          subjectRows)}</section>
      <section class="card"><div class="card-header"><h3 class="card-title">Marks by subject</h3></div>
        ${table(['Subject Code', 'Subject', 'Assessments', 'Average'], data.bySubject.map((item) =>
          `<tr><td>${esc(item.code)}</td><td>${esc(item.subject)}</td><td>${esc(item.assessments)}</td><td>${esc(asPercent(item.percentage))}</td></tr>`).join(''))}</section>`);
  }

  async function studentAttendance() {
    const result = await api('/attendance');
    const totals = result.data.reduce((summary, row) => {
      summary.total += 1;
      if (row.status === 'Present' || row.status === 'Late') summary.present += 1;
      return summary;
    }, { total: 0, present: 0 });
    pageTitle('Attendance Log & Target Predictor', 'Attendance records and calculated progress against the 75% attendance target.', `
      <div class="stats-grid">${stat('Present or late', totals.present, 'fa-calendar-check')}${stat('Recorded sessions', totals.total, 'fa-list')}
        ${stat('Attendance', asPercent(totals.total ? totals.present * 100 / totals.total : null), 'fa-chart-simple')}</div>
      <section class="card"><div class="card-header"><h3 class="card-title">Attendance Log</h3></div>
        ${table(['Date', 'Subject Code', 'Subject', 'Status'], result.data.map((row) =>
          `<tr><td>${friendlyDate(row.date)}</td><td>${esc(row.subject_code)}</td><td>${esc(row.subject)}</td><td>${esc(row.status)}</td></tr>`).join(''))}</section>`);
  }

  async function studentMarks() {
    const result = await api('/marks');
    pageTitle('Academic Examination Transcript', 'Marks saved for your assessments.', `
      <section class="card"><div class="card-header"><h3 class="card-title">Examination Marks Summary</h3></div>
        ${table(['Subject Code', 'Subject', 'Assessment', 'Date', 'Obtained / Max', 'Percentage'],
          result.data.map((row) => `<tr><td>${esc(row.subject_code)}</td><td>${esc(row.subject)}</td>
            <td>${esc(row.assessment)}</td><td>${friendlyDate(row.assessment_date)}</td>
            <td>${esc(`${row.score} / ${row.max_marks}`)}</td><td>${esc(asPercent(row.percentage))}</td></tr>`).join(''))}</section>`);
  }

  async function studentPerformance() {
    const result = await api('/marks');
    const bySubject = new Map();
    result.data.forEach((record) => {
      if (!bySubject.has(record.subject)) bySubject.set(record.subject, []);
      bySubject.get(record.subject).push(record);
    });
    pageTitle('Personal Academic Analytics', 'Actual assessment scores reported by your instructors.', `
      ${Array.from(bySubject, ([subject, marks]) => `<section class="card"><div class="card-header"><h3 class="card-title">${esc(subject)}</h3></div>
        ${table(['Assessment', 'Date', 'Score', 'Maximum', 'Percentage'],
          marks.map((row) => `<tr><td>${esc(row.assessment)}</td><td>${friendlyDate(row.assessment_date)}</td>
            <td>${esc(row.score)}</td><td>${esc(row.max_marks)}</td><td>${esc(asPercent(row.percentage))}</td></tr>`).join(''))}</section>`).join('')
        || '<section class="card">No marks have been recorded yet.</section>'}`);
  }

  async function studentProfile() {
    const result = await api('/profile');
    const profile = result.user;
    pageTitle('Student Profile Details', 'Update your name or phone number; academic enrollment fields are read-only.', `
      <section class="card" style="max-width:700px"><form data-action="update-profile">
        ${input('Full Name', 'name', 'text', true, '', profile.name)}
        ${input('Phone Number', 'phone', 'tel', false, '10 digits', profile.phone || '')}
        <dl class="form-grid">
          <div><dt>Email</dt><dd>${esc(profile.email)}</dd></div><div><dt>Roll Number</dt><dd>${esc(profile.roll_no)}</dd></div>
          <div><dt>Department</dt><dd>${esc(profile.department)}</dd></div><div><dt>Branch</dt><dd>${esc(profile.branch)}</dd></div>
          <div><dt>Semester</dt><dd>${esc(profile.semester)}</dd></div><div><dt>Section</dt><dd>${esc(profile.section)}</dd></div>
        </dl>${submitButton('Save Profile')}</form></section>`);
  }

  async function teacherDashboard() {
    const data = await api('/dashboard/teacher');
    pageTitle(`Welcome, ${user.name}`, 'Your assigned teaching workload and class overview.', `
      <div class="stats-grid">${stat('Assignments', data.stats.assignments, 'fa-book-open')}
        ${stat('Students', data.stats.students, 'fa-users')}</div>
      <section class="card"><div class="card-header"><h3 class="card-title">Teaching assignments</h3></div>
        ${table(['ID', 'Subject', 'Branch', 'Semester', 'Section', 'Students', 'Sessions', 'Attendance', 'Assessments', 'Marks Average'],
          data.assignments.map((a) => `<tr><td>${esc(a.assignment_id)}</td><td>${esc(`${a.subject_code} — ${a.subject}`)}</td>
            <td>${esc(a.branch)}</td><td>${esc(a.semester)}</td><td>${esc(a.section)}</td><td>${esc(a.students)}</td>
            <td>${esc(a.sessions)}</td><td>${esc(asPercent(a.attendance_percentage))}</td><td>${esc(a.assessments)}</td>
            <td>${esc(asPercent(a.average_marks_percentage))}</td></tr>`).join(''))}</section>
      <div class="form-grid"><a class="btn btn-primary" href="teacher_attendance.html">Mark Attendance</a>
        <a class="btn btn-secondary" href="teacher_marks.html">Enter Marks</a></div>`);
  }

  async function teacherStudents() {
    currentAssignments = (await api('/assignments')).data;
    const selected = Number(new URLSearchParams(location.search).get('assignment_id')) || (currentAssignments[0] || {}).id;
    const roster = selected ? await api(`/assignments/${selected}/roster`) : { assignment: null, data: [] };
    currentRoster = roster.data;
    pageTitle('Assigned Students Roster', 'Choose a backend teaching assignment to view its active student roster.', `
      <section class="card"><form data-action="select-roster" class="form-grid">
        ${select('Teaching assignment', 'assignment_id', assignmentOptions(currentAssignments, selected), true)}
        <button class="btn btn-primary" type="submit">Load roster</button></form></section>
      <section class="card"><div class="card-header"><h3 class="card-title">${roster.assignment ? esc(assignmentLabel(roster.assignment)) : 'No assignment selected'}</h3></div>
        ${table(['Roll No', 'Student Name', 'Email'], roster.data.map((row) =>
          `<tr><td>${esc(row.roll_no)}</td><td>${esc(row.name)}</td><td>${esc(row.email)}</td></tr>`).join(''))}</section>`);
  }

  async function teacherAttendance() {
    currentAssignments = (await api('/assignments')).data;
    const params = new URLSearchParams(location.search);
    const assignmentId = Number(params.get('assignment_id')) || (currentAssignments[0] || {}).id;
    const date = params.get('date') || dateToday();
    const rosterData = assignmentId ? await api(`/assignments/${assignmentId}/roster`) : { assignment: null, data: [] };
    currentRoster = rosterData.data;
    const records = assignmentId ? (await api(`/attendance?assignment_id=${assignmentId}&date=${encodeURIComponent(date)}`)).data : [];
    const statusByStudent = new Map(records.map((record) => [record.student_id, record.status]));
    const rowHtml = currentRoster.map((student) => {
      const selectedStatus = statusByStudent.get(student.student_id) || 'Present';
      return `<tr data-student-id="${esc(student.student_id)}"><td>${esc(student.roll_no)}</td><td>${esc(student.name)}</td><td>
        <select class="form-select attendance-status" aria-label="Attendance for ${esc(student.name)}">
          ${['Present', 'Absent', 'Late', 'Excused'].map((status) => `<option ${selectedStatus === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select></td></tr>`;
    }).join('');
    pageTitle('Class Attendance Matrix', 'Load the assigned class roster and save attendance for a selected date.', `
      <section class="card"><form data-action="load-attendance" class="form-grid">
        ${select('Teaching assignment', 'assignment_id', assignmentOptions(currentAssignments, assignmentId), true)}
        ${input('Attendance date', 'date', 'date', true, '', date)}
        <button type="submit" class="btn btn-primary">Load roster</button></form></section>
      <section class="card"><div class="card-header"><h3 class="card-title">Attendance Sheet · ${rosterData.assignment ? esc(assignmentLabel(rosterData.assignment)) : 'No assignment'}</h3>
        <span>Date: ${friendlyDate(date)}</span></div>
        <div class="form-grid"><button type="button" class="btn btn-secondary" data-action="mark-status" data-status="Present">Mark all present</button>
          <button type="button" class="btn btn-secondary" data-action="mark-status" data-status="Absent">Mark all absent</button></div>
        <form data-action="save-attendance"><input type="hidden" name="assignment_id" value="${esc(assignmentId || '')}">
          <input type="hidden" name="date" value="${esc(date)}">
          ${table(['Roll No', 'Student', 'Status'], rowHtml)}
          ${submitButton('Save Attendance')}</form></section>`);
  }

  async function loadTeacherAssessments(assignmentId) {
    currentAssessments = assignmentId ? (await api(`/assessments?assignment_id=${assignmentId}`)).data : [];
  }

  async function teacherMarks() {
    currentAssignments = (await api('/assignments')).data;
    const params = new URLSearchParams(location.search);
    const assignmentId = Number(params.get('assignment_id')) || (currentAssignments[0] || {}).id;
    await loadTeacherAssessments(assignmentId);
    const assessmentId = Number(params.get('assessment_id')) || (currentAssessments[0] || {}).id;
    let rosterData = assignmentId ? await api(`/assignments/${assignmentId}/roster`) : { data: [] };
    currentRoster = rosterData.data;
    const marks = assignmentId ? (await api(`/marks?assignment_id=${assignmentId}`)).data : [];
    const scoreMap = new Map(marks.filter((record) => record.assessment_id === assessmentId).map((record) => [record.student_id, record.score]));
    const chosenAssessment = currentAssessments.find((item) => item.id === assessmentId);
    const rows = currentRoster.map((student) => `<tr data-student-id="${esc(student.student_id)}"><td>${esc(student.roll_no)}</td>
      <td>${esc(student.name)}</td><td><input type="number" name="score" class="form-control score-input" min="0"
        max="${esc(chosenAssessment ? chosenAssessment.max_marks : '')}" step="any" value="${esc(scoreMap.get(student.student_id) ?? '')}" required></td></tr>`).join('');
    pageTitle('Enter Examination Marks', 'Create assessments from real assignment IDs, then record each roster member’s score.', `
      <section class="card"><div class="card-header"><h3 class="card-title">Create Assessment</h3></div>
        <form data-action="create-assessment" class="form-grid">
          ${select('Teaching assignment', 'assignment_id', assignmentOptions(currentAssignments, assignmentId), true)}
          ${input('Assessment title', 'title', 'text', true, 'Class Test 1')}
          ${input('Maximum marks', 'max_marks', 'number', true, '', '20')}
          ${input('Assessment date', 'assessment_date', 'date', true, '', dateToday())}${submitButton('Create Assessment')}</form></section>
      <section class="card"><div class="card-header"><h3 class="card-title">Record or update marks</h3></div>
        <form data-action="save-marks">
          <div class="form-grid">${select('Teaching assignment', 'assignment_id', assignmentOptions(currentAssignments, assignmentId), true, 'marks-assignment')}
            ${select('Assessment', 'assessment_id', escOptions(currentAssessments, 'id', (a) =>
              `${a.title} · ${a.assessment_date} · max ${a.max_marks}`), true, 'assessment-select')}
            <button type="button" class="btn btn-secondary" data-action="load-mark-roster">Load roster</button></div>
          <input type="hidden" name="assignment_id" value="${esc(assignmentId || '')}">
          <input type="hidden" name="assessment_id" value="${esc(assessmentId || '')}">
          ${table(['Roll No', 'Student', 'Score'], rows)}${submitButton('Save Marks')}</form></section>`);
    const marksForm = document.querySelector('[data-action="save-marks"]');
    if (marksForm) {
      marksForm.elements.assignment_id.value = assignmentId || '';
      marksForm.elements.assessment_id.value = assessmentId || '';
      const assessmentSelect = document.getElementById('assessment-select');
      if (assessmentSelect) assessmentSelect.value = assessmentId || '';
    }
  }

  async function teacherPerformance() {
    const [assignments, marks] = await Promise.all([api('/assignments'), api('/marks')]);
    pageTitle('Teaching Performance', 'Assignment summaries and student assessment results from the API.', `
      <section class="card"><div class="card-header"><h3 class="card-title">Assignment performance</h3></div>
        ${table(['Assignment ID', 'Subject', 'Branch', 'Semester', 'Section'], assignments.data.map((a) =>
          `<tr><td>${esc(a.id)}</td><td>${esc(`${a.subject_code} — ${a.subject}`)}</td><td>${esc(a.branch)}</td>
            <td>${esc(a.semester)}</td><td>${esc(a.section)}</td></tr>`).join(''))}</section>
      <section class="card"><div class="card-header"><h3 class="card-title">Recorded marks</h3></div>
        ${table(['Roll No', 'Student', 'Subject', 'Assessment', 'Score', 'Percentage'],
          marks.data.map((m) => `<tr><td>${esc(m.roll_no)}</td><td>${esc(m.student)}</td><td>${esc(m.subject)}</td>
            <td>${esc(m.assessment)}</td><td>${esc(`${m.score}/${m.max_marks}`)}</td><td>${esc(asPercent(m.percentage))}</td></tr>`).join(''))}</section>`);
  }

  async function guardedPage() {
    const prefix = pageName.split('_')[0];
    const expectedRole = rolePages[prefix];
    if (!expectedRole) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      location.replace(`login.html?role=${expectedRole}`);
      return;
    }
    try {
      const result = await api('/auth/me');
      user = result.user;
      if (user.role !== expectedRole) {
        location.replace(`${user.role.toLowerCase()}_dashboard.html`);
        return;
      }
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      updateNavbar();
      const handlers = {
        admin_dashboard: adminDashboard,
        admin_departments: async () => {
          await loadCatalog();
          await adminReferencePage(new URLSearchParams(location.search).get('view') || 'departments');
        },
        admin_branches: async () => { await loadCatalog(); await adminReferencePage('branches'); },
        admin_subjects: async () => { await loadCatalog(); await adminReferencePage('subjects'); },
        admin_students: adminStudents,
        admin_teachers: adminTeachers,
        admin_reports: adminReports,
        student_dashboard: studentDashboard,
        student_attendance: studentAttendance,
        student_marks: studentMarks,
        student_performance: studentPerformance,
        student_profile: studentProfile,
        teacher_dashboard: teacherDashboard,
        teacher_students: teacherStudents,
        teacher_attendance: teacherAttendance,
        teacher_marks: teacherMarks,
        teacher_performance: teacherPerformance,
      };
      if (handlers[pageName]) await handlers[pageName]();
    } catch (error) {
      if (!localStorage.getItem(TOKEN_KEY)) {
        location.replace('login.html');
        return;
      }
      pageTitle('Unable to load portal data', 'The page could not retrieve its live backend data.', `<p class="portal-error">${esc(error.message)}</p>`);
    }
  }

  async function submitAction(form) {
    const action = form.dataset.action;
    const fields = Object.fromEntries(new FormData(form).entries());
    let result;
    if (action === 'filter-students') {
      const query = new URLSearchParams(Object.fromEntries(Object.entries(fields).filter(([, value]) => value)));
      location.href = `admin_students.html${query.size ? `?${query}` : ''}`;
      return;
    }
    if (action === 'filter-report') {
      const query = new URLSearchParams(Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== '')));
      location.href = `admin_reports.html?${query}`;
      return;
    }
    if (action === 'update-profile') {
      result = await api('/profile', { method: 'PATCH', body: { name: fields.name, phone: fields.phone || null } });
      user = { ...user, ...result.user };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      await studentProfile();
      message('Profile updated.');
      return;
    }
    if (action === 'change-password') {
      if (fields.new_password !== fields.confirm_password) {
        throw new Error('New password and confirmation do not match.');
      }
      result = await api('/auth/change-password', {
        method: 'POST',
        body: { current_password: fields.current_password, new_password: fields.new_password },
      });
      await guardedPage();
      message(result.message || 'Password changed.');
      return;
    }
    const routes = {
      'create-departments': ['/admin/departments', 'POST'],
      'create-branches': ['/admin/branches', 'POST'],
      'create-semesters': ['/admin/semesters', 'POST'],
      'create-sections': ['/admin/sections', 'POST'],
      'create-subjects': ['/admin/subjects', 'POST'],
      'create-student': ['/admin/students', 'POST'],
      'create-teacher': ['/admin/teachers', 'POST'],
      'create-assignment': ['/admin/assignments', 'POST'],
      'create-assessment': ['/assessments', 'POST'],
    };
    if (action === 'create-student') fields.username = fields.roll_no;
    if (action === 'create-assessment') {
      fields.max_marks = Number(fields.max_marks);
      result = await api('/assessments', { method: 'POST', body: fields });
      await teacherMarksWithId(fields.assignment_id, result.id);
      message(`Assessment “${result.title}” created.`);
      return;
    }
    if (action === 'save-attendance') {
      const loader = document.querySelector('[data-action="load-attendance"]');
      if (loader && (loader.elements.assignment_id.value !== fields.assignment_id
        || loader.elements.date.value !== fields.date)) {
        location.href = `teacher_attendance.html?assignment_id=${encodeURIComponent(loader.elements.assignment_id.value)}&date=${encodeURIComponent(loader.elements.date.value)}`;
        return;
      }
      const records = Array.from(form.querySelectorAll('tbody tr[data-student-id]')).map((row) => ({
        student_id: Number(row.dataset.studentId),
        status: row.querySelector('.attendance-status').value,
      }));
      result = await api('/attendance/bulk', {
        method: 'POST',
        body: { assignment_id: Number(fields.assignment_id), date: fields.date, records },
      });
      message(result.message || 'Attendance saved.');
      return;
    }
    if (action === 'save-marks') {
      const assignmentId = document.getElementById('marks-assignment').value;
      const assessmentId = document.getElementById('assessment-select').value;
      if (assignmentId !== fields.assignment_id || assessmentId !== fields.assessment_id) {
        location.href = `teacher_marks.html?assignment_id=${encodeURIComponent(assignmentId)}&assessment_id=${encodeURIComponent(assessmentId)}`;
        return;
      }
      const records = Array.from(form.querySelectorAll('tbody tr[data-student-id]')).map((row) => ({
        student_id: Number(row.dataset.studentId),
        score: Number(row.querySelector('.score-input').value),
      }));
      if (!records.length) throw new Error('Load a roster before saving marks.');
      result = await api(`/assessments/${encodeURIComponent(assessmentId)}/marks`, {
        method: 'POST', body: { records },
      });
      message(result.message || 'Marks saved.');
      return;
    }
    if (routes[action]) {
      const [path, method] = routes[action];
      result = await api(path, { method, body: fields });
      if (action === 'create-assignment') {
        await adminTeachers();
      } else if (action === 'create-teacher') {
        await adminTeachers();
      } else if (action === 'create-student') {
        await adminStudents();
      } else {
        const resource = action.replace('create-', '');
        if (resource !== 'assignments') {
          if (resource === 'semesters' || resource === 'sections') {
            catalog = null;
            await loadCatalog();
          }
          await adminReferencePage(resource);
        }
        message('Record created.');
      }
      if (action === 'create-assignment' || action === 'create-teacher' || action === 'create-student') message('Record created.');
      return;
    }
    if (action === 'select-roster') {
      location.href = `teacher_students.html?assignment_id=${encodeURIComponent(fields.assignment_id)}`;
      return;
    }
    if (action === 'load-attendance') {
      location.href = `teacher_attendance.html?assignment_id=${encodeURIComponent(fields.assignment_id)}&date=${encodeURIComponent(fields.date)}`;
      return;
    }
    throw new Error('This form is not connected to a supported action.');
  }

  async function teacherMarksWithId(assignmentId, assessmentId) {
    location.href = `teacher_marks.html?assignment_id=${encodeURIComponent(assignmentId)}&assessment_id=${encodeURIComponent(assessmentId)}`;
  }

  async function clickAction(button) {
    const action = button.dataset.action;
    const id = Number(button.dataset.id);
    if (action === 'print-report') { window.print(); return; }
    if (action === 'mark-status') {
      document.querySelectorAll('.attendance-status').forEach((control) => { control.value = button.dataset.status; });
      return;
    }
    if (action === 'delete-reference') {
      const resource = new URLSearchParams(location.search).get('view') || pageName.replace('admin_', '');
      if (!window.confirm(`Delete this ${resource.slice(0, -1)}? Related records may prevent deletion.`)) return;
      await api(`/admin/${resource}/${id}`, { method: 'DELETE' });
    if (resource !== 'departments') {
      catalog = null;
      await loadCatalog();
    }
    await adminReferencePage(resource);
      message('Record deleted.');
      return;
    }
    if (action === 'edit-reference') {
      const resource = new URLSearchParams(location.search).get('view') || pageName.replace('admin_', '');
      const row = button.closest('tr');
      if (resource === 'semesters') {
        const number = window.prompt('Semester number (1–12):', row.cells[1].textContent.trim());
        if (number == null || !number.trim()) return;
        const name = window.prompt('Semester name:', row.cells[2].textContent.trim());
        if (name == null || !name.trim()) return;
        await api(`/admin/${resource}/${id}`, { method: 'PATCH', body: { number: Number(number), name: name.trim() } });
        catalog = null;
        await loadCatalog();
        await adminReferencePage(resource);
        message('Record updated.');
        return;
      }
      if (resource === 'sections') {
        const name = window.prompt('Section name:', row.cells[1].textContent.trim());
        if (name == null || !name.trim()) return;
        const current = catalog.sections.find((item) => item.id === id);
        const branchId = window.prompt('Branch ID:', current ? current.branch_id : '');
        if (branchId == null || !branchId.trim()) return;
        const semesterId = window.prompt('Semester ID:', current ? current.semester_id : '');
        if (semesterId == null || !semesterId.trim()) return;
        await api(`/admin/${resource}/${id}`, { method: 'PATCH', body: {
          name: name.trim(), branch_id: Number(branchId), semester_id: Number(semesterId),
        } });
        catalog = null;
        await loadCatalog();
        await adminReferencePage(resource);
        message('Record updated.');
        return;
      }
      const nameIndex = resource === 'subjects' ? 2 : 1;
      const codeIndex = resource === 'subjects' ? 1 : 2;
      const rowName = window.prompt('Enter the updated name:', row.cells[nameIndex].textContent.trim());
      if (rowName == null || !rowName.trim()) return;
      const code = window.prompt('Enter the updated code:', row.cells[codeIndex].textContent.trim());
      if (code == null) return;
      const body = { name: rowName.trim() };
      if (code.trim()) body.code = code.trim();
      await api(`/admin/${resource}/${id}`, { method: 'PATCH', body });
      if (resource !== 'departments') {
        catalog = null;
        await loadCatalog();
      }
      await adminReferencePage(resource);
      message('Record updated.');
      return;
    }
    if (action === 'delete-assignment') {
      if (!window.confirm('Remove this teaching assignment?')) return;
      await api(`/admin/assignments/${id}`, { method: 'DELETE' });
      await adminTeachers();
      message('Assignment removed.');
      return;
    }
    if (action === 'toggle-user') {
      const row = button.closest('tr');
      const active = button.textContent.trim() === 'Deactivate';
      await api(`/admin/users/${id}/status`, { method: 'PATCH', body: { is_active: !active } });
      if (pageName === 'admin_students') await adminStudents(); else await adminTeachers();
      message(`Account ${active ? 'deactivated' : 'activated'}.`);
      return;
    }
    if (action === 'reset-password') {
      const password = window.prompt('Enter a temporary password (at least 8 characters):');
      if (password == null) return;
      await api(`/admin/users/${id}/password`, { method: 'POST', body: { password } });
      message('Password reset.');
      return;
    }
    if (action === 'edit-user') {
      const row = button.closest('tr');
      const cells = row.querySelectorAll('td');
      const currentName = cells[pageName === 'admin_students' ? 1 : 0].textContent.trim();
      const name = window.prompt('Full name:', currentName);
      if (name == null || !name.trim()) return;
      const phone = window.prompt('Phone number (leave blank to keep unchanged):', '');
      if (phone == null) return;
      const body = { name: name.trim() };
      if (phone.trim()) body.phone = phone.trim();
      const resource = pageName === 'admin_students' ? 'students' : 'teachers';
      await api(`/admin/${resource}/${id}`, { method: 'PATCH', body });
      if (resource === 'students') await adminStudents(); else await adminTeachers();
      message('Account updated.');
      return;
    }
    if (action === 'load-mark-roster') {
      const assignmentId = document.getElementById('marks-assignment').value;
      const assessmentId = document.getElementById('assessment-select').value;
      location.href = `teacher_marks.html?assignment_id=${encodeURIComponent(assignmentId)}&assessment_id=${encodeURIComponent(assessmentId)}`;
    }
  }

  async function dispatchAction(action) {
    try {
      if (action instanceof HTMLFormElement) {
        await submitAction(action);
      } else {
        await clickAction(action);
      }
    } catch (error) {
      message(error.message, true);
    }
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.action) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dispatchAction(form);
    } else if (form.closest('.content-body')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button instanceof HTMLFormElement) return;
    event.preventDefault();
    dispatchAction(button);
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.setProperty('--portal-api-base', `"${API_BASE}"`);
    document.querySelectorAll('.btn-logout').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        clearSession();
        location.href = 'login.html';
      });
    });
    const pageContent = document.querySelector('.content-body');
    if (pageContent) pageContent.style.visibility = 'hidden';
    loginPage();
    registrationPage();
    otpPage();
    guardedPage();
  });
}());
