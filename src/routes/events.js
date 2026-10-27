'use strict';
const express = require('express');
const { authenticate } = require('../middleware/auth');
const events = require('../services/events');

const router = express.Router();

router.get('/', authenticate({ allowQueryToken: true }), (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('event: ready\ndata: {}\n\n');
  events.addClient(res, req.user);
});

module.exports = router;
