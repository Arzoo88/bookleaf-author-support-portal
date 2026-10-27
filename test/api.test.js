'use strict';
process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = ''; // force the offline fallback path
process.env.OPENAI_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert');
require('../src/db');
const { seedIfEmpty } = require('../src/seed');
const { createApp } = require('../src/app');

let server;
let base;
test.before(async () => {
  seedIfEmpty();
  await new Promise((r) => { server = createApp().listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const login = async (email, password) => (await call('POST', '/api/auth/login', { body: { email, password } })).body.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('rejects unauthenticated and bad logins', async () => {
  assert.strictEqual((await call('GET', '/api/books')).status, 401);
  const bad = await call('POST', '/api/auth/login', { body: { email: 'arzoo.rai@email.com', password: 'nope' } });
  assert.strictEqual(bad.status, 401);
  const invalid = await call('POST', '/api/auth/login', { body: { email: 'not-an-email' } });
  assert.strictEqual(invalid.status, 400);
  assert.strictEqual(invalid.body.error.code, 'VALIDATION_ERROR');
});

test('author only sees own books and tickets; admin routes are forbidden', async () => {
  const token = await login('arzoo.rai@email.com', 'Author@123');
  const { body } = await call('GET', '/api/books', { token });
  assert.strictEqual(body.books.length, 2);
  assert.ok(body.books.every((b) => b.author_id === 'AUTH001'));
  assert.strictEqual((await call('GET', '/api/admin/tickets', { token })).status, 403);
  const mine = await call('GET', '/api/tickets', { token });
  assert.ok(mine.body.tickets.every((t) => !('priority' in t) && !('notes' in t)));
  // ticket #4 belongs to another author -> 404, not 403
  assert.strictEqual((await call('GET', '/api/tickets/4', { token })).status, 404);
});

test('cannot raise a ticket about someone else\'s book', async () => {
  const token = await login('arzoo.rai@email.com', 'Author@123');
  const r = await call('POST', '/api/tickets', { token, body: { book_id: 'BK003', subject: 'Hello there', description: 'This is not my book at all' } });
  assert.strictEqual(r.status, 400);
});

test('full ticket lifecycle with fallback AI', async () => {
  const author = await login('meera.nair@email.com', 'Author@123');
  const admin = await login('admin@bookleaf.com', 'Admin@123');

  const created = await call('POST', '/api/tickets', { token: author, body: {
    book_id: 'BK009', subject: 'Amazon says unavailable', description: 'My book Letters from Lakshadweep shows Currently Unavailable on Amazon.' } });
  assert.strictEqual(created.status, 201);
  const id = created.body.ticket.id;

  await sleep(100); // async triage
  let detail = await call('GET', `/api/admin/tickets/${id}`, { token: admin });
  assert.strictEqual(detail.body.ticket.category, 'Distribution & Availability');
  assert.strictEqual(detail.body.ticket.priority, 'High');
  assert.strictEqual(detail.body.ticket.category_source, 'rules');

  const draft = await call('POST', `/api/admin/tickets/${id}/draft`, { token: admin });
  assert.strictEqual(draft.status, 200);
  assert.strictEqual(draft.body.draft.source, 'template');
  assert.match(draft.body.draft.text, /24–48 hours/);

  // admin override sticks and invalidates the cached draft
  const patched = await call('PATCH', `/api/admin/tickets/${id}`, { token: admin, body: { priority: 'Critical', assigned_to: 'me' } });
  assert.strictEqual(patched.body.ticket.priority, 'Critical');
  assert.strictEqual(patched.body.ticket.priority_source, 'admin');

  await call('POST', `/api/admin/tickets/${id}/notes`, { token: admin, body: { body: 'Internal: re-sync requested' } });
  const reply = await call('POST', `/api/admin/tickets/${id}/reply`, { token: admin, body: { body: draft.body.draft.text, status: 'Resolved' } });
  assert.strictEqual(reply.status, 201);

  const view = await call('GET', `/api/tickets/${id}`, { token: author });
  assert.strictEqual(view.body.ticket.status, 'Resolved');
  assert.strictEqual(view.body.ticket.messages.length, 1);
  assert.ok(!JSON.stringify(view.body).includes('Internal: re-sync'), 'internal notes must never reach authors');

  // author follow-up re-opens
  const follow = await call('POST', `/api/tickets/${id}/messages`, { token: author, body: { body: 'Still not live, please check.' } });
  assert.strictEqual(follow.body.ticket.status, 'Open');
});

test('admin filters and urgency sort', async () => {
  const admin = await login('admin@bookleaf.com', 'Admin@123');
  const all = await call('GET', '/api/admin/tickets', { token: admin });
  const unresolved = all.body.tickets.filter((t) => !['Resolved', 'Closed'].includes(t.status));
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  for (let i = 1; i < unresolved.length; i++) assert.ok(rank[unresolved[i - 1].priority] <= rank[unresolved[i].priority]);
  const f = await call('GET', '/api/admin/tickets?category=ISBN%20%26%20Metadata%20Issues', { token: admin });
  assert.ok(f.body.tickets.length >= 1 && f.body.tickets.every((t) => t.category === 'ISBN & Metadata Issues'));
  assert.strictEqual((await call('GET', '/api/admin/tickets?status=Bogus', { token: admin })).status, 400);
});
