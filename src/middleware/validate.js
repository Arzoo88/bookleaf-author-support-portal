'use strict';
const { ApiError } = require('../errors');

/** validate(schema, 'body' | 'query' | 'params') — replaces req[source] with the parsed value. */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
  }
  req[source] = result.data;
  next();
};
module.exports = { validate };
