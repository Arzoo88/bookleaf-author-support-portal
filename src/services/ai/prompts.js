'use strict';
const { CATEGORIES, PRIORITIES } = require('../../constants');
const { getContext } = require('./knowledgeBase');

/* ---------- 1. Triage (classification + priority) ----------
 * Deliberately tiny: no knowledge base, no history, no author data — only the ticket text.
 * Output is capped at ~120 tokens. Runs once per ticket.
 */
const TRIAGE_SYSTEM = `You triage support tickets for BookLeaf Publishing, a self-publishing company. Return ONLY a JSON object, no prose, no code fences.

Schema: {"category": <one of ${JSON.stringify(CATEGORIES)}>, "priority": <one of ${JSON.stringify(PRIORITIES)}>, "reason": <max 20 words>}

Category guide:
- Royalty & Payments: royalties, payouts, bank details, amounts, sales figures.
- ISBN & Metadata Issues: ISBN, wrong/duplicate identifiers, title/description/author-name data.
- Printing & Quality: misprints, binding, colour, blurry images, reprints, author copies.
- Distribution & Availability: not listed / unavailable / out of stock on Amazon, Flipkart, BookLeaf Store.
- Book Status & Production Updates: where a book is in production (cover, typesetting, proofreading), timelines.
- General Inquiry: anything else (bio updates, how-to, account questions).

Priority guide:
- Critical: money long overdue (several months with no payout), book not purchasable anywhere, legal/copyright issue, author threatening to leave.
- High: ISBN errors (always at least High), defective printed copies, royalty overdue or clearly wrong, book unavailable on a platform.
- Medium: production delays, normal royalty/sales questions, listing questions.
- Low: cosmetic or informational requests that can wait (bio updates, how-to questions).
Judge by urgency and business/financial impact, not by the author's tone alone.`;

function triageUser(ticket, bookTitle) {
  return `Book: ${bookTitle || 'General / Account Level'}\nSubject: ${ticket.subject}\nDescription: ${ticket.description.slice(0, 1500)}`;
}

/* ---------- 2. Draft response ----------
 * Receives: persona + tone, only the policy section for the ticket's category, one matching
 * example, a compact FACTS JSON (the linked book in full, other books as one-liners), and the
 * last few thread messages. Never the whole KB or the whole history.
 */
function draftSystem(category) {
  const ctx = getContext(category);
  return `You are a support representative at BookLeaf Publishing writing a reply to an author. Write the reply the human admin will review and send.

ABOUT BOOKLEAF
${ctx.core}

${ctx.tone}

POLICY (the only source of truth for rules, timelines and amounts)
${ctx.policy}

CALIBRATION EXAMPLE
Author query: "${ctx.example.query}"
How to respond: ${ctx.example.guidance}

HARD RULES
- Use ONLY facts from the POLICY and the FACTS block. Never invent dates, amounts, ticket numbers, tracking numbers or bank details.
- You cannot see bank details or internal systems. Do not claim to have checked them; say what the team will verify and by when.
- If a figure the author needs is missing or null in FACTS (e.g. a book still in production has no MRP or royalty), say so plainly and explain what happens next instead of making one up.
- If FACTS show the author has never been paid (never_paid) or royalty is below the ₹1,000 threshold, explain that accurately using the royalty_cycle dates.
- Own BookLeaf mistakes directly; never blame the author.
- Plain text, no markdown, no subject line, 90–170 words. Start with "Hi <first name>,". Sign off as "Warm regards,\\nBookLeaf Author Support Team".
- End with one clear next step.`;
}

function draftUser({ ticket, bookTitle, facts, thread }) {
  const recent = thread.slice(-4).map((m) => `${m.sender_role.toUpperCase()}: ${m.body.slice(0, 600)}`).join('\n');
  return `FACTS (JSON)
${JSON.stringify(facts)}

TICKET
Category: ${ticket.category}
Book: ${bookTitle || 'General / Account Level'}
Subject: ${ticket.subject}
Description: ${ticket.description.slice(0, 2000)}
${recent ? `\nRECENT MESSAGES (oldest first)\n${recent}` : ''}

Write the reply now.`;
}

module.exports = { TRIAGE_SYSTEM, triageUser, draftSystem, draftUser };
