const { rateLimit } = require('express-rate-limit');

function createAuthRateLimits(overrides = {}) {
  const makeLimiter = (windowMs, limit, error) => rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error }),
  });

  return {
    login: makeLimiter(overrides.loginWindowMs || 15 * 60 * 1000, overrides.loginLimit || 10,
      'Too many login attempts. Try again later.'),
    register: makeLimiter(overrides.otpWindowMs || 60 * 60 * 1000, overrides.otpRequestLimit || 5,
      'Too many verification code requests. Try again later.'),
    verifyOtp: makeLimiter(overrides.verifyWindowMs || 15 * 60 * 1000, overrides.verifyLimit || 10,
      'Too many verification attempts. Try again later.'),
  };
}

module.exports = { createAuthRateLimits };