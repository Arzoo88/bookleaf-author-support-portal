'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { ApiError, forbidden } = require('../errors');

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

/**
 * Authenticates every request that passes through it.
 * Token comes from "Authorization: Bearer <jwt>". The SSE endpoint cannot set headers
 * from the browser's EventSource, so it alone may use ?access_token= (see routes/events.js).
 */
function authenticate({ allowQueryToken = false } = {}) {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    let token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token && allowQueryToken) token = req.query.access_token;
    if (!token) return next(new ApiError(401, 'UNAUTHENTICATED', 'Missing credentials'));
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      // Re-read the user so deleted/changed accounts stop working immediately.
      const user = db.prepare('SELECT id, email, role, name, author_id FROM users WHERE id = ?').get(payload.sub);
      if (!user) throw new Error('unknown user');
      req.user = user;
      next();
    } catch {
      next(new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
    }
  };
}

const requireRole = (role) => (req, _res, next) =>
  req.user && req.user.role === role ? next() : next(forbidden(`${role} access required`));

module.exports = { signToken, authenticate, requireRole };
