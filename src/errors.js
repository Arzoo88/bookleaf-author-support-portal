'use strict';
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
const forbidden = (msg = 'You do not have access to this resource') => new ApiError(403, 'FORBIDDEN', msg);
const badRequest = (msg, details) => new ApiError(400, 'BAD_REQUEST', msg, details);
module.exports = { ApiError, notFound, forbidden, badRequest };
