const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const { getDatabase } = require('./database');
const { authenticate } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const managementRoutes = require('./routes/management');
const dataManagementRoutes = require('./routes/dataManagement');
const academicRoutes = require('./routes/academics');
const dashboardRoutes = require('./routes/dashboard');
const { HttpError } = require('./utils/http');

const openApi = {
  openapi: '3.0.3',
  info: {
    title: 'Smart College Portal API',
    version: '1.0.0',
    description: 'REST API for authentication, administration, attendance, marks, dashboards and reports.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': { get: { security: [], summary: 'Health check', responses: { 200: { description: 'API is ready' } } } },
    '/auth/login': { post: { security: [], summary: 'Sign in', responses: { 200: { description: 'JWT and profile' } } } },
    '/auth/register': { post: { security: [], summary: 'Request student registration OTP', responses: { 202: { description: 'OTP dispatched' } } } },
    '/auth/verify-otp': { post: { security: [], summary: 'Verify OTP and create student account', responses: { 201: { description: 'JWT and profile' } } } },
    '/auth/me': { get: { summary: 'Get current profile', responses: { 200: { description: 'Profile' } } } },
    '/auth/change-password': { post: { summary: 'Change the current user password', responses: { 200: { description: 'Password changed' } } } },
    '/admin/catalog': { get: { summary: 'Get registration and management lookup data', responses: { 200: { description: 'Lookup data' } } } },
    '/catalog': { get: { security: [], summary: 'Get academic lookup data for registration', responses: { 200: { description: 'Departments, branches, semesters and sections' } } } },
    '/admin/data/counts': { get: { summary: 'Get record counts for database tables', responses: { 200: { description: 'Table counts' } } } },
    '/admin/data/{resource}': { get: { summary: 'Search, filter, paginate, or export admin database records', responses: { 200: { description: 'Record list or CSV export' } } } },
    '/admin/data/{resource}/{id}': {
      get: { summary: 'View an individual database record', responses: { 200: { description: 'Record details' } } },
      patch: { summary: 'Update supported record fields', responses: { 200: { description: 'Updated record' } } },
      delete: { summary: 'Delete supported academic records', responses: { 204: { description: 'Deleted record' } } },
    },
    '/admin/students': { get: { summary: 'List and filter students', responses: { 200: { description: 'Paginated student list' } } }, post: { summary: 'Create student', responses: { 201: { description: 'Created student' } } } },
    '/admin/students/{id}': { patch: { summary: 'Update student profile/class details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated student' } } } },
    '/admin/teachers': { get: { summary: 'List teachers', responses: { 200: { description: 'Paginated teacher list' } } }, post: { summary: 'Create teacher', responses: { 201: { description: 'Created teacher' } } } },
    '/admin/teachers/{id}': { patch: { summary: 'Update teacher profile', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated teacher' } } } },
    '/admin/departments': { get: { summary: 'List departments', responses: { 200: { description: 'Department list' } } }, post: { summary: 'Create department', responses: { 201: { description: 'Created department' } } } },
    '/admin/departments/{id}': { patch: { summary: 'Update department', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated department' } } }, delete: { summary: 'Delete department', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted department' } } } },
    '/admin/branches': { get: { summary: 'List branches', responses: { 200: { description: 'Branch list' } } }, post: { summary: 'Create branch', responses: { 201: { description: 'Created branch' } } } },
    '/admin/branches/{id}': { patch: { summary: 'Update branch', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated branch' } } }, delete: { summary: 'Delete branch', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted branch' } } } },
    '/admin/semesters': { get: { summary: 'List semesters', responses: { 200: { description: 'Semester list' } } }, post: { summary: 'Create semester', responses: { 201: { description: 'Created semester' } } } },
    '/admin/semesters/{id}': {
      patch: { summary: 'Update semester', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated semester' } } },
      delete: { summary: 'Delete semester', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted semester' } } },
    },
    '/admin/sections': { get: { summary: 'List sections', responses: { 200: { description: 'Section list' } } }, post: { summary: 'Create section', responses: { 201: { description: 'Created section' } } } },
    '/admin/sections/{id}': {
      patch: { summary: 'Update section', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated section' } } },
      delete: { summary: 'Delete section', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted section' } } },
    },
    '/admin/subjects': { get: { summary: 'List subjects', responses: { 200: { description: 'Subject list' } } }, post: { summary: 'Create subject', responses: { 201: { description: 'Created subject' } } } },
    '/admin/subjects/{id}': {
      patch: { summary: 'Update subject', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated subject' } } },
      delete: { summary: 'Delete subject', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted subject' } } },
    },
    '/admin/assignments': { get: { summary: 'List teaching assignments', responses: { 200: { description: 'Assignment list' } } }, post: { summary: 'Assign teacher to class and subject', responses: { 201: { description: 'Created assignment' } } } },
    '/admin/assignments/{id}': { delete: { summary: 'Remove a teaching assignment', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted assignment' } } } },
    '/admin/users/{id}/status': { patch: { summary: 'Activate or deactivate a student or teacher account', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated account status' } } } },
    '/admin/users/{id}/password': { post: { summary: 'Reset a student or teacher password', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Password reset' } } } },
    '/assignments': { get: { summary: 'List assignments visible to the current user', responses: { 200: { description: 'Assignment list' } } } },
    '/assignments/{id}/roster': { get: { summary: 'List a class roster', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Class roster' } } } },
    '/attendance': { get: { summary: 'List attendance records', responses: { 200: { description: 'Attendance records' } } } },
    '/attendance/bulk': { post: { summary: 'Create or update class attendance', responses: { 200: { description: 'Attendance saved' } } } },
    '/assessments': { get: { summary: 'List assessments', responses: { 200: { description: 'Assessment list' } } }, post: { summary: 'Create assessment', responses: { 201: { description: 'Assessment created' } } } },
    '/assessments/{id}/marks': { post: { summary: 'Create or update student marks', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Marks saved' } } } },
    '/marks': { get: { summary: 'List marks visible to the current user', responses: { 200: { description: 'Marks list' } } } },
    '/profile': { get: { summary: 'Get the current student profile', responses: { 200: { description: 'Student profile' } } }, patch: { summary: 'Update the current student profile', responses: { 200: { description: 'Updated profile' } } } },
    '/dashboard': { get: { summary: 'Get role-specific dashboard data', responses: { 200: { description: 'Dashboard data' } } } },
    '/dashboard/reports/attendance': { get: { summary: 'List students below attendance threshold', responses: { 200: { description: 'Attendance report' } } } },
    '/dashboard/reports/performance': { get: { summary: 'List students below marks threshold', responses: { 200: { description: 'Performance report' } } } },
  },
};

function createApp(options = {}) {
  const db = options.db || getDatabase();
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  const origins = (process.env.CORS_ORIGIN || '*').split(',').map((value) => value.trim());
  app.use(cors({ origin: origins.includes('*') ? '*' : origins }));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    if (req.body == null) req.body = {};
    if (typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    return next();
  });
  if (process.env.NODE_ENV !== 'test') app.use(morgan('combined'));

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'smart-college-backend' }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'smart-college-backend' }));
  app.get('/api/openapi.json', (req, res) => res.json(openApi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApi));
  app.use('/api', (req, res, next) => { req.db = db; next(); });
  app.use('/api/auth', authRoutes);
  app.get('/api/catalog', (req, res) => res.json({
    departments: db.prepare('SELECT id, name, code FROM departments ORDER BY name').all(),
    branches: db.prepare('SELECT id, name, code, department_id FROM branches ORDER BY name').all(),
    semesters: db.prepare('SELECT id, number, name FROM semesters ORDER BY number').all(),
    sections: db.prepare('SELECT id, name, branch_id, semester_id FROM sections ORDER BY name').all(),
  }));
  app.use('/api', authenticate(db));
  app.use('/api/admin/data', dataManagementRoutes);
  app.use('/api/admin', managementRoutes);
  app.use('/api', academicRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
  if (options.publicDir) {
    app.use(express.static(options.publicDir, { dotfiles: 'deny', index: 'index.html' }));
  }

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must contain valid JSON' });
    if (error.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'The request conflicts with existing records or related data' });
    console.error('Unhandled API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

module.exports = { createApp, openApi };
