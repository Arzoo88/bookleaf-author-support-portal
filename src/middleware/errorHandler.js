'use strict';
const { ApiError } = require('../errors');

const notFoundHandler = (req, _res, next) =>
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' } });
}
module.exports = { notFoundHandler, errorHandler };
