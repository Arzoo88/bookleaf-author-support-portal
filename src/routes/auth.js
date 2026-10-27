'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db');
const { signToken, authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { ApiError } = require('../errors');

const router = express.Router();
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });

router.post('/login', rateLimit({ windowMs: 60_000, max: 10 }), validate(loginSchema), (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Same message for unknown email and wrong password: don't reveal which accounts exist.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role, author_id: user.author_id },
  });
});

router.get('/me', authenticate(), (req, res) => res.json({ user: req.user }));

module.exports = router;
