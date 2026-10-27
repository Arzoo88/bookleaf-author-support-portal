'use strict';
/**
 * Builds the compact, factual context that is given to the model (and to the template fallback).
 * Everything the model needs to be *specific* is computed here in code, so we don't ask the
 * LLM to do date maths or guess figures.
 */
const DAY = 86400000;
const fmt = (d) => d.toISOString().slice(0, 10);

/** Royalty cycle per policy: quarterly calc, paid within 45 days of quarter end. */
function royaltyCycle(now = new Date()) {
  const y = now.getUTCFullYear();
  const ends = [new Date(Date.UTC(y - 1, 11, 31)), new Date(Date.UTC(y, 2, 31)), new Date(Date.UTC(y, 5, 30)),
    new Date(Date.UTC(y, 8, 30)), new Date(Date.UTC(y, 11, 31)), new Date(Date.UTC(y + 1, 2, 31))];
  const lastEnd = [...ends].reverse().find((e) => e <= now);
  const nextEnd = ends.find((e) => e > now);
  const due = (e) => new Date(e.getTime() + 45 * DAY);
  return {
    last_quarter_end: fmt(lastEnd),
    last_quarter_payout_due_by: fmt(due(lastEnd)),
    last_quarter_payout_window_open: due(lastEnd) >= now,
    current_quarter_end: fmt(nextEnd),
    current_quarter_payout_due_by: fmt(due(nextEnd)),
  };
}

function bookFacts(b) {
  const live = b.status === 'Published & Live';
  return {
    book_id: b.book_id, title: b.title, status: b.status,
    isbn: b.isbn, genre: b.genre, publication_date: b.publication_date,
    mrp: b.mrp, royalty_per_copy: b.author_royalty_per_copy,
    copies_sold: b.total_copies_sold, royalty_earned: b.total_royalty_earned,
    royalty_paid: b.royalty_paid, royalty_pending: b.royalty_pending,
    last_payout_date: b.last_royalty_payout_date, never_paid: live && !b.last_royalty_payout_date,
    below_payout_threshold: b.royalty_pending > 0 && b.royalty_pending < 1000,
    print_partner: b.print_partner, available_on: JSON.parse(b.available_on || '[]'),
  };
}

/** If the ticket names a book, send only that book; otherwise a compact one-line-per-book summary. */
function buildFacts({ author, books, ticket, now = new Date() }) {
  const linked = ticket.book_id ? books.find((b) => b.book_id === ticket.book_id) : null;
  return {
    today: fmt(now),
    author: { name: author.name, city: author.city, joined: author.joined_date },
    royalty_cycle: royaltyCycle(now),
    ticket_book: linked ? bookFacts(linked) : null,
    other_books: (linked ? books.filter((b) => b !== linked) : books).map((b) => ({
      title: b.title, status: b.status, royalty_pending: b.royalty_pending, copies_sold: b.total_copies_sold,
    })),
  };
}
module.exports = { royaltyCycle, buildFacts };
