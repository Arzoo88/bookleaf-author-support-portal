'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { CATEGORIES, PRIORITIES, STATUSES } = require('../constants');
const tickets = require('../services/tickets');
const ai = require('../services/ai');

const router = express.Router();
router.use(authenticate(), requireRole('admin'));

// Express 4 doesn't catch rejected promises from async handlers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const idParams = z.object({ id: z.coerce.number().int().positive() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  from: date.optional(),
  to: date.optional(),
  assigned: z.enum(['me', 'unassigned']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['urgency', 'newest', 'oldest']).optional(),
});

const patchSchema = z.object({
  status: z.enum(STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigned_to: z.enum(['me']).nullable().optional(), // 'me' = assign to myself, null = unassign
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

const replySchema = z.object({
  body: z.string().trim().min(1, 'Reply cannot be empty').max(5000),
  status: z.enum(STATUSES).default('In Progress'),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

router.get('/tickets', validate(listQuery, 'query'), (req, res) => {
  res.json({ tickets: tickets.listForAdmin(req.query, req.user.id) });
});

router.get('/tickets/:id', validate(idParams, 'params'), (req, res) => {
  const row = tickets.getRow(req.params.id);
  const author = db.prepare('SELECT author_id, name, email, phone, city FROM authors WHERE author_id = ?').get(row.author_id);
  const book = row.book_id ? db.prepare('SELECT * FROM books WHERE book_id = ?').get(row.book_id) : null;
  res.json({
    ticket: tickets.adminView(row, {
      author, book: book && { ...book, available_on: JSON.parse(book.available_on) },
      messages: tickets.getMessages(row.id), notes: tickets.getNotes(row.id),
    }),
    ai_enabled: ai.isConfigured(),
  });
});

router.patch('/tickets/:id', validate(idParams, 'params'), validate(patchSchema), (req, res) => {
  const row = tickets.getRow(req.params.id);
  const { status, category, priority, assigned_to } = req.body;
  const sets = [];
  const args = [];
  if (status) { sets.push('status = ?'); args.push(status); }
  if (category && category !== row.category) {
    // Category drives the draft's policy context, so a cached draft is now stale.
    sets.push("category = ?, category_source = 'admin', ai_draft = NULL, ai_draft_source = NULL, ai_draft_at = NULL");
    args.push(category);
  }
  if (priority && priority !== row.priority) { sets.push("priority = ?, priority_source = 'admin'"); args.push(priority); }
  if (assigned_to === 'me') { sets.push('assigned_to = ?'); args.push(req.user.id); }
  if (assigned_to === null) sets.push('assigned_to = NULL');
  if (sets.length) {
    db.prepare(`UPDATE tickets SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(...args, row.id);
    tickets.notify(row);
  }
  res.json({ ticket: tickets.adminView(tickets.getRow(row.id)) });
});

// Generate (or regenerate) the AI draft. Never fails: falls back to a policy template.
router.post('/tickets/:id/draft', validate(idParams, 'params'),
  rateLimit({ windowMs: 60_000, max: 20, key: (r) => `d:${r.user.id}` }),
  wrap(async (req, res) => {
    const row = tickets.getRow(req.params.id);
    const draft = await ai.draftReply(row);
    db.prepare(`UPDATE tickets SET ai_draft = ?, ai_draft_source = ?, ai_draft_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(draft.text, draft.source, row.id);
    res.json({ draft: { text: draft.text, source: draft.source }, ai_enabled: ai.isConfigured() });
  }));

router.post('/tickets/:id/reply', validate(idParams, 'params'), validate(replySchema), (req, res) => {
  const row = tickets.getRow(req.params.id);
  tickets.addMessage(row, { role: 'admin', userId: req.user.id, body: req.body.body });
  // Replying claims the ticket if nobody owns it yet; clears the now-stale cached draft.
  db.prepare(`UPDATE tickets SET status = ?, assigned_to = COALESCE(assigned_to, ?), ai_draft = NULL, ai_draft_source = NULL, ai_draft_at = NULL WHERE id = ?`)
    .run(req.body.status, req.user.id, row.id);
  tickets.notify(row);
  res.status(201).json({ ticket: tickets.adminView(tickets.getRow(row.id), { messages: tickets.getMessages(row.id) }) });
});

router.post('/tickets/:id/notes', validate(idParams, 'params'), validate(noteSchema), (req, res) => {
  const row = tickets.getRow(req.params.id);
  db.prepare('INSERT INTO ticket_notes (ticket_id, admin_id, body) VALUES (?,?,?)').run(row.id, req.user.id, req.body.body);
  // No SSE to authors: notes are internal. Admins refresh via their own ticket.updated stream.
  res.status(201).json({ notes: tickets.getNotes(row.id) });
});

module.exports = router;
