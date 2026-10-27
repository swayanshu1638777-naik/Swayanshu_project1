class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requiredText(value, field, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${field} is required and must be at most ${max} characters`);
  }
  return value.trim();
}

function requiredLoginPassword(value, field = 'password', max = 128) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new HttpError(400, `${field} is required and must be at most ${max} characters`);
  }
  return value;
}

function requiredPassword(value, field = 'password', max = 128) {
  const password = requiredLoginPassword(value, field, max);
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new HttpError(400, `${field} must be at most 72 UTF-8 bytes`);
  }
  return password;
}

function positiveId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, `${field} must be a positive integer`);
  return id;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function pagination(query) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = {
  HttpError,
  asyncRoute,
  isValidDate,
  pagination,
  positiveId,
  requiredLoginPassword,
  requiredPassword,
  requiredText,
};
