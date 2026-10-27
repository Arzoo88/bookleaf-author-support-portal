'use strict';
// Exercises the real LLM code path against a local mock of the Anthropic Messages API.
const http = require('http');
const test = require('node:test');
const assert = require('node:assert');

const calls = [];
let mode = 'ok';
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    calls.push(body);
    if (mode === 'down') { res.writeHead(503); return res.end('{}'); }
    const isTriage = body.system.includes('You triage support tickets');
    let text;
    if (mode === 'garbage') text = 'Sorry, I cannot do that.';
    else if (isTriage) text = '```json\n{"category":"ISBN & Metadata Issues","priority":"Medium","reason":"ISBN mismatch"}\n```';
    else text = 'Hi Priya,\n\nThank you for flagging this ISBN mismatch. We are escalating it to the production team now and will resolve it within 48 hours.\n\nWarm regards,\nBookLeaf Author Support Team';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
  });
});

let db, ai;
test.before(async () => {
  await new Promise((r) => mock.listen(0, r));
  process.env.DB_PATH = ':memory:';
  process.env.AI_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.AI_BASE_URL = `http://localhost:${mock.address().port}`;
  db = require('../src/db');
  require('../src/seed').seedIfEmpty();
  ai = require('../src/services/ai');
});
test.after(() => mock.close());

const ticket = () => ({ id: 2, author_id: 'AUTH001', book_id: 'BK002', category: 'ISBN & Metadata Issues',
  subject: 'Different ISBN on Amazon', description: 'The ISBN on Amazon is different from my physical copy.' });

test('triage parses fenced JSON, validates it, and enforces ISBN >= High', async () => {
  const r = await ai.triage(ticket());
  assert.strictEqual(r.source, 'ai');
  assert.strictEqual(r.category, 'ISBN & Metadata Issues');
  assert.strictEqual(r.priority, 'High'); // model said Medium; KB business rule bumps it
});

test('draft prompt is lean: only the matching policy section and the linked book', async () => {
  calls.length = 0;
  const r = await ai.draftReply(ticket());
  assert.strictEqual(r.source, 'ai');
  const { system, messages } = calls[0];
  assert.ok(system.includes('ISBN policy'));
  assert.ok(!system.includes('Royalty policy') && !system.includes('Production stages'));
  const user = messages[0].content;
  assert.ok(user.includes('The Saffron Diaries'));
  assert.ok(!user.includes('Whispers of the Ganges') || user.includes('other_books')); // sibling books only as one-liners
  assert.ok(user.length < 4000);
});

test('garbage model output falls back to rules/template instead of failing', async () => {
  mode = 'garbage';
  const t = await ai.triage(ticket());
  assert.strictEqual(t.source, 'rules');
  const d = await ai.draftReply(ticket());
  assert.strictEqual(d.source, 'template'); // too-short/unusable draft is rejected
  mode = 'ok';
});

test('provider outage -> graceful fallback, then circuit breaker stops calling the API', async () => {
  mode = 'down';
  calls.length = 0;
  for (let i = 0; i < 3; i++) {
    const r = await ai.triage(ticket());
    assert.strictEqual(r.source, 'rules');
  }
  const before = calls.length;
  const d = await ai.draftReply(ticket()); // breaker is open now
  assert.strictEqual(d.source, 'template');
  assert.strictEqual(calls.length, before, 'no further HTTP calls while the circuit is open');
});
