'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { ApiError, badRequest, notFound } = require('../errors');
const tickets = require('../services/tickets');

const router = express.Router();
router.use(authenticate(), requireRole('author'));

const createSchema = z.object({
  book_id: z.string().trim().min(1).nullish(),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(150),
  description: z.string().trim().min(10, 'Please describe the issue in at least 10 characters').max(5000),
  attachment_name: z.string().trim().max(255).nullish(), // UI-only attachment: filename is recorded, file is not stored
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const idParams = z.object({ id: z.coerce.number().int().positive() });

/** Loads a ticket and enforces ownership. 404 (not 403) so ids of other authors' tickets aren't revealed. */
function ownTicket(req) {
  const row = tickets.getRow(req.params.id);
  if (row.author_id !== req.user.author_id) throw notFound('Ticket');
  return row;
}

router.get('/', (req, res) => {
  res.json({ tickets: tickets.listForAuthor(req.user.author_id) });
});

router.post('/', rateLimit({ windowMs: 60_000, max: 10, key: (r) => `t:${r.user.id}` }), validate(createSchema), (req, res) => {
  const { book_id, subject, description, attachment_name } = req.body;
  if (book_id) {
    const book = db.prepare('SELECT author_id FROM books WHERE book_id = ?').get(book_id);
    if (!book || book.author_id !== req.user.author_id) throw badRequest('Selected book does not belong to your account');
  }
  const ticket = tickets.create({ author_id: req.user.author_id, book_id, subject, description, attachment_name });
  res.status(201).json({ ticket: tickets.authorView(ticket, []) });
});

router.get('/:id', validate(idParams, 'params'), (req, res) => {
  const row = ownTicket(req);
  res.json({ ticket: tickets.authorView(row, tickets.getMessages(row.id)) });
});

// Author follow-up on their own ticket. Re-opens a Resolved ticket; Closed tickets are final.
router.post('/:id/messages', validate(idParams, 'params'), validate(messageSchema), (req, res) => {
  const row = ownTicket(req);
  if (row.status === 'Closed') throw new ApiError(409, 'TICKET_CLOSED', 'This ticket is closed. Please submit a new query.');
  tickets.addMessage(row, { role: 'author', userId: req.user.id, body: req.body.body });
  db.prepare(`UPDATE tickets SET status = CASE WHEN status = 'Resolved' THEN 'Open' ELSE status END, ai_draft = NULL WHERE id = ?`).run(row.id);
  tickets.notify(row);
  res.status(201).json({ ticket: tickets.authorView(tickets.getRow(row.id), tickets.getMessages(row.id)) });
});

module.exports = router;
