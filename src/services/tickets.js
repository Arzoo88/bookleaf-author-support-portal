'use strict';
/** Ticket data access + orchestration. Routes stay thin; all SQL for tickets lives here. */
const db = require('../db');
const ai = require('./ai');
const events = require('./events');
const { notFound } = require('../errors');

const BASE_SELECT = `
  SELECT t.*, b.title AS book_title, a.name AS author_name, u.name AS assignee_name
  FROM tickets t
  JOIN authors a ON a.author_id = t.author_id
  LEFT JOIN books b ON b.book_id = t.book_id
  LEFT JOIN users u ON u.id = t.assigned_to`;

const PRIORITY_RANK_SQL = `CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END`;

function getRow(id) {
  const row = db.prepare(`${BASE_SELECT} WHERE t.id = ?`).get(id);
  if (!row) throw notFound('Ticket');
  return row;
}

const getMessages = (ticketId) =>
  db.prepare(`SELECT m.id, m.sender_role, m.body, m.created_at, u.name AS sender_name
              FROM ticket_messages m JOIN users u ON u.id = m.sender_id
              WHERE m.ticket_id = ? ORDER BY m.id`).all(ticketId);

const getNotes = (ticketId) =>
  db.prepare(`SELECT n.id, n.body, n.created_at, u.name AS admin_name
              FROM ticket_notes n JOIN users u ON u.id = n.admin_id
              WHERE n.ticket_id = ? ORDER BY n.id`).all(ticketId);

/** What an author may see: no priority, AI reasoning, drafts, assignee or internal notes. */
function authorView(row, messages) {
  const view = {
    id: row.id, subject: row.subject, description: row.description,
    book_id: row.book_id, book_title: row.book_title,
    attachment_name: row.attachment_name, status: row.status,
    created_at: row.created_at, updated_at: row.updated_at,
  };
  if (messages) view.messages = messages;
  return view;
}

function adminView(row, extra = {}) {
  const { ai_draft, ai_draft_source, ai_draft_at, ...rest } = row; // draft has its own endpoint/field
  return { ...rest, draft: ai_draft ? { text: ai_draft, source: ai_draft_source, generated_at: ai_draft_at } : null, ...extra };
}

function create({ author_id, book_id, subject, description, attachment_name, userId }) {
  const info = db.prepare(
    `INSERT INTO tickets (author_id, book_id, subject, description, attachment_name) VALUES (?,?,?,?,?)`,
  ).run(author_id, book_id || null, subject, description, attachment_name || null);
  const ticket = getRow(info.lastInsertRowid);
  events.publish('ticket.created', { ticketId: ticket.id, authorId: author_id });
  runTriage(ticket); // fire-and-forget: ticket creation never waits on (or fails because of) the AI
  return ticket;
}

async function runTriage(ticket) {
  try {
    const t = await ai.triage(ticket);
    // Only fill fields an admin hasn't already overridden while the AI was thinking.
    db.prepare(`UPDATE tickets SET category = ?, category_source = ?, triage_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE id = ? AND category_source = 'pending'`).run(t.category, t.source, t.reason, ticket.id);
    db.prepare(`UPDATE tickets SET priority = ?, priority_source = ?
                WHERE id = ? AND priority_source = 'pending'`).run(t.priority, t.source, ticket.id);
    events.publish('ticket.updated', { ticketId: ticket.id, authorId: ticket.author_id });
  } catch (err) {
    console.error('[triage] failed for ticket', ticket.id, err);
  }
}

function listForAuthor(authorId) {
  return db.prepare(`${BASE_SELECT} WHERE t.author_id = ? ORDER BY t.updated_at DESC`).all(authorId).map((r) => authorView(r));
}

/** Admin queue. Default sort = urgency: unresolved first, then priority, then oldest first. */
function listForAdmin(f, adminId) {
  const where = [];
  const args = [];
  if (f.status) { where.push('t.status = ?'); args.push(f.status); }
  if (f.category) { where.push('t.category = ?'); args.push(f.category); }
  if (f.priority) { where.push('t.priority = ?'); args.push(f.priority); }
  if (f.from) { where.push('t.created_at >= ?'); args.push(f.from); }
  if (f.to) { where.push('t.created_at < ?'); args.push(`${f.to}T23:59:59.999Z`); }
  if (f.assigned === 'me') { where.push('t.assigned_to = ?'); args.push(adminId); }
  if (f.assigned === 'unassigned') where.push('t.assigned_to IS NULL');
  if (f.q) { where.push('(t.subject LIKE ? OR a.name LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }

  const order = f.sort === 'newest' ? 't.created_at DESC'
    : f.sort === 'oldest' ? 't.created_at ASC'
      : `(t.status IN ('Resolved','Closed')) ASC, ${PRIORITY_RANK_SQL} ASC, t.created_at ASC`;

  const sql = `${BASE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT 500`;
  return db.prepare(sql).all(...args).map((r) => adminView(r));
}

function touch(id) {
  db.prepare(`UPDATE tickets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(id);
}

function addMessage(ticket, { role, userId, body }) {
  db.prepare('INSERT INTO ticket_messages (ticket_id, sender_role, sender_id, body) VALUES (?,?,?,?)')
    .run(ticket.id, role, userId, body);
  touch(ticket.id);
}

function notify(ticket) {
  events.publish('ticket.updated', { ticketId: ticket.id, authorId: ticket.author_id });
}

module.exports = {
  getRow, getMessages, getNotes, authorView, adminView, create, listForAuthor, listForAdmin,
  addMessage, touch, notify,
};
