'use strict';
const { ApiError } = require('../errors');

/** Tiny in-memory fixed-window limiter. Swap for Redis-backed limiter when running >1 instance. */
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, _res, next) => {
    const k = key(req);
    const now = Date.now();
    const entry = hits.get(k) && hits.get(k).reset > now ? hits.get(k) : { count: 0, reset: now + windowMs };
    entry.count += 1;
    hits.set(k, entry);
    if (entry.count > max) {
      return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests, please slow down'));
    }
    next();
  };
}
module.exports = { rateLimit };
