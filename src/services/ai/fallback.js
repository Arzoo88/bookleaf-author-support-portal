'use strict';
/**
 * Deterministic fallback used when the LLM is unavailable (no key, outage, rate limit, bad output).
 * Tickets are still triaged and admins still get a usable, policy-accurate starting point.
 */
const RULES = [
  ['ISBN & Metadata Issues', /\bisbn\b|duplicate (id|isbn)|wrong book|metadata|book (title|description) (is )?(wrong|incorrect)/i],
  ['Printing & Quality', /print|misprint|binding|blurry|smudg|misalign|colou?r|quality|reprint|damaged|defect|author cop/i],
  ['Distribution & Availability', /unavailable|out of stock|not (showing|listed|available)|listing|amazon|flipkart|store|re-?sync/i],
  ['Royalty & Payments', /royalt|payout|payment|paid|bank|earning|too low|not received|haven'?t received/i],
  ['Book Status & Production Updates', /typeset|cover design|proof|editing|production|when will|how long|status|stuck|delay/i],
];

function classify({ subject, description }) {
  const text = `${subject}\n${description}`;
  const category = (RULES.find(([, re]) => re.test(text)) || ['General Inquiry'])[0];

  let priority = 'Medium';
  const months = text.match(/(\d+)\s*(\+\s*)?months?/i);
  const longWait = (months && Number(months[1]) >= 4) || /\b(a|one|over a|\d+)\s*years?\b/i.test(text);
  if (category === 'Royalty & Payments') {
    if (/(not|n't|never|no)\b.{0,40}(royalt|payment|payout)/i.test(text) && longWait) priority = 'Critical';
    else if (/not received|haven'?t received|never (received|been paid)|too low|wrong|missing|overdue/i.test(text)) priority = 'High';
  } else if (category === 'ISBN & Metadata Issues') {
    priority = /different|duplicate|wrong|mismatch|incorrect|error/i.test(text) ? 'High' : 'Medium';
  } else if (category === 'Printing & Quality') {
    priority = /blurry|misprint|defect|damaged|terrible|misalign|binding/i.test(text) ? 'High' : 'Medium';
  } else if (category === 'Distribution & Availability') {
    priority = /unavailable|not (showing|available|listed)/i.test(text) ? 'High' : 'Medium';
  } else if (category === 'General Inquiry') {
    priority = 'Low';
  }
  if (/legal|lawyer|copyright|plagiar|refund|cancel my (contract|book)/i.test(text)) priority = 'Critical';
  return { category, priority, reason: 'Keyword-based triage (AI unavailable)' };
}

const first = (name) => (name || 'there').split(' ')[0];
const sign = 'Warm regards,\nBookLeaf Author Support Team';

const TEMPLATES = {
  'Royalty & Payments': ({ name, facts }) => {
    const b = facts.ticket_book;
    const c = facts.royalty_cycle;
    const detail = b
      ? b.never_paid
        ? `I can see "${b.title}" has ${b.copies_sold} copies sold and ₹${b.royalty_pending} in royalty pending, with no payout made yet.`
        : `For "${b.title}", ${b.copies_sold} copies are sold, ₹${b.royalty_paid} has been paid and ₹${b.royalty_pending} is pending${b.last_payout_date ? ` (last payout ${b.last_payout_date})` : ''}.`
      : '';
    const thr = b && b.below_payout_threshold ? ' Pending royalties below ₹1,000 roll over to the next quarter, so this amount will be included once the threshold is crossed.' : '';
    return `Hi ${first(name)},\n\nThank you for reaching out, and I understand how important clear royalty information is. ${detail}\n\nRoyalties are calculated quarterly and paid within 45 days of quarter end. The quarter ending ${c.last_quarter_end} is due by ${c.last_quarter_payout_due_by}, and the quarter ending ${c.current_quarter_end} is due by ${c.current_quarter_payout_due_by}.${thr} Net profit per book is MRP minus printing cost, platform commission and shipping, and 80% of it goes to you.\n\nOur team will verify the details on your account and get back to you within 48 hours; we can also share a line-by-line royalty breakdown if you'd like.\n\n${sign}`;
  },
  'ISBN & Metadata Issues': ({ name }) =>
    `Hi ${first(name)},\n\nThank you for flagging this. An ISBN or metadata error is a serious data issue and we are treating it as high priority. I'm escalating it to our production team right now.\n\nOur team will investigate and get back to you within 48 hours with a resolution. If you can send a screenshot or the ISBN you see on the platform and on your physical copy, it will speed this up.\n\n${sign}`,
  'Printing & Quality': ({ name }) =>
    `Hi ${first(name)},\n\nI'm sorry your copies didn't meet the standard we hold ourselves to. Once we verify the issue, we will arrange a free reprint.\n\nCould you share a few clear photos of the defective copies (the affected pages and the binding)? After we verify them, the reprint is delivered in 5–7 business days.\n\n${sign}`,
  'Distribution & Availability': ({ name }) =>
    `Hi ${first(name)},\n\nThank you for letting us know. A book showing as unavailable is usually a stock sync issue, and I'm asking our distribution team to trigger a re-sync now.\n\nPlease allow 24–48 hours for the listing to show as available again. If it still doesn't, reply here and we'll escalate it.\n\n${sign}`,
  'Book Status & Production Updates': ({ name, facts }) => {
    const b = facts.ticket_book;
    return `Hi ${first(name)},\n\nThank you for checking in. ${b ? `"${b.title}" is currently at the stage: ${b.status}.` : 'I will confirm the current stage of your book.'} Delays usually happen at Cover Design (waiting on approvals) and Proofreading (revision rounds), and we'll keep you moving through it together.\n\nOur team will confirm the exact next milestone and an updated timeline within 48 hours.\n\n${sign}`;
  },
  'General Inquiry': ({ name }) =>
    `Hi ${first(name)},\n\nThank you for your message. Metadata updates, such as a book description change, can be submitted through your dashboard or by emailing our team, and changes typically reflect on platforms within 3–5 business days.\n\nLet us know if you'd like us to take care of it for you.\n\n${sign}`,
};

function draft({ ticket, author, facts }) {
  const tpl = TEMPLATES[ticket.category] || TEMPLATES['General Inquiry'];
  return tpl({ name: author.name, facts });
}

module.exports = { classify, draft };
