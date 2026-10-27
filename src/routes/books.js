'use strict';
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate());

const MIN_PAYOUT = 1000;

const present = (b) => ({
  ...b,
  available_on: JSON.parse(b.available_on || '[]'),
  in_production: b.status !== 'Published & Live',
  // Helps the UI explain *why* a pending balance hasn't been paid (policy: ₹1,000 minimum).
  below_payout_threshold: b.royalty_pending > 0 && b.royalty_pending < MIN_PAYOUT,
});

/** Authors: always their own books (author_id comes from the token, never from the request). Admins: ?author_id= optional. */
router.get('/', (req, res) => {
  const authorId = req.user.role === 'author' ? req.user.author_id : req.query.author_id;
  const rows = authorId
    ? db.prepare('SELECT * FROM books WHERE author_id = ? ORDER BY publication_date IS NULL, publication_date').all(authorId)
    : db.prepare('SELECT * FROM books ORDER BY author_id, book_id').all();
  res.json({ books: rows.map(present) });
});

module.exports = router;
