'use strict';
const path = require('path');
const express = require('express');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/books', require('./routes/books'));
  app.use('/api/tickets', require('./routes/tickets'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/events', require('./routes/events'));
  app.use('/api', notFoundHandler); // unknown API paths -> JSON 404, not the SPA

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
