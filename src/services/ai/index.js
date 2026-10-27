'use strict';
/**
 * AI facade used by the routes. Every function here ALWAYS resolves with a usable result:
 * LLM failure -> rules/template fallback, flagged via `source` so the UI can say so.
 */
const { z } = require('zod');
const db = require('../../db');
const { CATEGORIES, PRIORITIES } = require('../../constants');
const llm = require('./llm');
const prompts = require('./prompts');
const fallback = require('./fallback');
const { buildFacts } = require('./facts');

const triageSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  reason: z.string().max(200).default(''),
});

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

const bookTitle = (ticket) =>
  ticket.book_id ? db.prepare('SELECT title FROM books WHERE book_id = ?').get(ticket.book_id)?.title : null;

async function triage(ticket) {
  try {
    const raw = await llm.complete({
      system: prompts.TRIAGE_SYSTEM,
      user: prompts.triageUser(ticket, bookTitle(ticket)),
      maxTokens: 150,
      temperature: 0,
    });
    const out = triageSchema.parse(parseJson(raw)); // never trust model output unvalidated
    // Business rule from the KB: ISBN errors are never below High.
    if (out.category === 'ISBN & Metadata Issues' && ['Medium', 'Low'].includes(out.priority)
      && /different|duplicate|wrong|mismatch|incorrect|error/i.test(`${ticket.subject} ${ticket.description}`)) {
      out.priority = 'High';
    }
    return { ...out, source: 'ai' };
  } catch (err) {
    if (!(err instanceof llm.LlmUnavailableError)) console.warn('[ai] triage output rejected:', err.message);
    return { ...fallback.classify(ticket), source: 'rules' };
  }
}

async function draftReply(ticket) {
  const author = db.prepare('SELECT * FROM authors WHERE author_id = ?').get(ticket.author_id);
  const books = db.prepare('SELECT * FROM books WHERE author_id = ?').all(ticket.author_id);
  const thread = db.prepare('SELECT sender_role, body FROM ticket_messages WHERE ticket_id = ? ORDER BY id').all(ticket.id);
  const facts = buildFacts({ author, books, ticket });

  try {
    const text = await llm.complete({
      system: prompts.draftSystem(ticket.category),
      user: prompts.draftUser({ ticket, bookTitle: bookTitle(ticket), facts, thread }),
      maxTokens: 450,
      temperature: 0.4,
    });
    if (text.length < 40) throw new Error('draft too short');
    return { text, source: 'ai' };
  } catch (err) {
    if (!(err instanceof llm.LlmUnavailableError)) console.warn('[ai] draft rejected:', err.message);
    return { text: fallback.draft({ ticket, author, facts }), source: 'template' };
  }
}

module.exports = { triage, draftReply, isConfigured: llm.isConfigured };
