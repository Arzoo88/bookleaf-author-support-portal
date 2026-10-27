'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('foreign_keys = ON');
if (config.dbPath !== ':memory:') db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('author','admin')),
  name          TEXT NOT NULL,
  author_id     TEXT UNIQUE            -- set for role=author, NULL for admins
);

CREATE TABLE IF NOT EXISTS authors (
  author_id   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  city        TEXT,
  joined_date TEXT
);

CREATE TABLE IF NOT EXISTS books (
  book_id                  TEXT PRIMARY KEY,
  author_id                TEXT NOT NULL REFERENCES authors(author_id),
  title                    TEXT NOT NULL,
  isbn                     TEXT,
  genre                    TEXT,
  publication_date         TEXT,
  status                   TEXT NOT NULL,
  mrp                      INTEGER,
  author_royalty_per_copy  INTEGER,
  total_copies_sold        INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned     INTEGER NOT NULL DEFAULT 0,
  royalty_paid             INTEGER NOT NULL DEFAULT 0,
  royalty_pending          INTEGER NOT NULL DEFAULT 0,
  last_royalty_payout_date TEXT,
  print_partner            TEXT,
  available_on             TEXT NOT NULL DEFAULT '[]'   -- JSON array
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);

CREATE TABLE IF NOT EXISTS tickets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id       TEXT NOT NULL REFERENCES authors(author_id),
  book_id         TEXT REFERENCES books(book_id),    -- NULL = General / Account Level
  subject         TEXT NOT NULL,
  description     TEXT NOT NULL,
  attachment_name TEXT,
  status          TEXT NOT NULL DEFAULT 'Open'
                  CHECK (status IN ('Open','In Progress','Resolved','Closed')),
  category        TEXT NOT NULL DEFAULT 'General Inquiry',
  category_source TEXT NOT NULL DEFAULT 'pending',   -- pending | ai | rules | admin
  priority        TEXT NOT NULL DEFAULT 'Medium'
                  CHECK (priority IN ('Critical','High','Medium','Low')),
  priority_source TEXT NOT NULL DEFAULT 'pending',
  triage_reason   TEXT,
  assigned_to     INTEGER REFERENCES users(id),
  ai_draft        TEXT,                              -- cached; regenerated on demand
  ai_draft_source TEXT,                              -- ai | template
  ai_draft_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, priority, created_at);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('author','admin')),
  sender_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id);

-- Internal notes live in their own table so they can never leak into author queries.
CREATE TABLE IF NOT EXISTS ticket_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  admin_id   INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_ticket ON ticket_notes(ticket_id);
`);

module.exports = db;
