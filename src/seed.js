'use strict';
/**
 * Seeds authors/books from the provided dataset, creates login accounts, and adds a few demo tickets.
 * Idempotent: the server calls seedIfEmpty() on boot; `npm run seed` wipes and re-seeds.
 *
 *   Authors : <email from dataset> / Author@123
 *   Admins  : admin@bookleaf.com, support@bookleaf.com / Admin@123
 */
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');
const fallback = require('./services/ai/fallback');

const AUTHOR_PASSWORD = 'Author@123';
const ADMIN_PASSWORD = 'Admin@123';
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

function reset() {
  db.exec('DELETE FROM ticket_notes; DELETE FROM ticket_messages; DELETE FROM tickets; DELETE FROM books; DELETE FROM authors; DELETE FROM users;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('tickets','ticket_messages','ticket_notes','users')");
}

function seed() {
  const data = JSON.parse(fs.readFileSync(config.seedFile, 'utf8'));
  const authorHash = bcrypt.hashSync(AUTHOR_PASSWORD, 10);
  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

  const insAuthor = db.prepare('INSERT INTO authors (author_id,name,email,phone,city,joined_date) VALUES (?,?,?,?,?,?)');
  const insUser = db.prepare('INSERT INTO users (email,password_hash,role,name,author_id) VALUES (?,?,?,?,?)');
  const insBook = db.prepare(`INSERT INTO books (book_id,author_id,title,isbn,genre,publication_date,status,mrp,author_royalty_per_copy,
    total_copies_sold,total_royalty_earned,royalty_paid,royalty_pending,last_royalty_payout_date,print_partner,available_on)
    VALUES (@book_id,@author_id,@title,@isbn,@genre,@publication_date,@status,@mrp,@author_royalty_per_copy,
    @total_copies_sold,@total_royalty_earned,@royalty_paid,@royalty_pending,@last_royalty_payout_date,@print_partner,@available_on)`);

  db.transaction(() => {
    const adminIds = [
      insUser.run('admin@bookleaf.com', adminHash, 'admin', 'Ops Admin', null).lastInsertRowid,
      insUser.run('support@bookleaf.com', adminHash, 'admin', 'Support Lead', null).lastInsertRowid,
    ];
    const userByAuthor = {};
    for (const a of data.authors) {
      insAuthor.run(a.author_id, a.name, a.email, a.phone, a.city, a.joined_date);
      userByAuthor[a.author_id] = insUser.run(a.email, authorHash, 'author', a.name, a.author_id).lastInsertRowid;
      for (const b of a.books) insBook.run({ ...b, author_id: a.author_id, available_on: JSON.stringify(b.available_on || []) });
    }

    // Demo tickets (triaged with the rules engine so seeding never needs an API key).
    const demo = [
      { a: 'AUTH003', b: 'BK005', h: 150, subject: 'No royalty received since publishing',
        d: "I published my book over a year ago and still haven't received any royalty. What's going on?" },
      { a: 'AUTH001', b: 'BK002', h: 40, subject: 'Different ISBN on Amazon than on my physical copy',
        d: 'The ISBN showing on Amazon for The Saffron Diaries is different from the one printed on my physical copy. Please fix this.' },
      { a: 'AUTH007', b: 'BK013', h: 96, subject: 'Midnight in Mysore cover design taking long', status: 'In Progress', assign: adminIds[1],
        d: "It's been 3 weeks and my book is still at cover design. When will it be done?",
        reply: 'Hi Sneha, thank you for checking in. Your cover concepts were shared on our side and we are waiting for your approval on the second option. Once approved, typesetting starts right away. We will send you the proof within 5 business days of approval.' },
      { a: 'AUTH006', b: null, h: 20, subject: 'Can I update my author bio?',
        d: 'I would like to update my author bio on all platforms. How do I do that?' },
      { a: 'AUTH009', b: 'BK016', h: 8, subject: 'Why have I not received my royalty?',
        d: 'My book The Nagpur Notebooks has been live for a while and I have not been paid anything yet.' },
    ];
    const insT = db.prepare(`INSERT INTO tickets (author_id,book_id,subject,description,status,category,category_source,priority,priority_source,triage_reason,assigned_to,created_at,updated_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insM = db.prepare('INSERT INTO ticket_messages (ticket_id,sender_role,sender_id,body,created_at) VALUES (?,?,?,?,?)');
    for (const t of demo) {
      const tri = fallback.classify({ subject: t.subject, description: t.d });
      const id = insT.run(t.a, t.b, t.subject, t.d, t.status || 'Open', tri.category, 'rules', tri.priority, 'rules', tri.reason,
        t.assign || null, hoursAgo(t.h), hoursAgo(t.reply ? t.h - 24 : t.h)).lastInsertRowid;
      if (t.reply) insM.run(id, 'admin', t.assign, t.reply, hoursAgo(t.h - 24));
    }
  })();
}

function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    seed();
    console.log('[seed] database seeded with sample authors, books and demo tickets');
  }
}

module.exports = { seed, reset, seedIfEmpty };

if (require.main === module) {
  if (process.argv.includes('--reset')) reset();
  seedIfEmpty();
  process.exit(0);
}
