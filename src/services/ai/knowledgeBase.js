'use strict';
/**
 * BookLeaf Knowledge Base, split into sections so each AI call only receives what it needs
 * (cost awareness: ~1/4 of the full KB per draft instead of all of it).
 */
const CORE = `BookLeaf Publishing is a self-publishing company in India and the US. Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid, with marketing and distribution add-ons). BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management. In-house printing facility and warehouse are in Delhi; print partners are Repro India and Epitome Books.`;

const TONE = `Tone rules:
- Empathetic and professional. Authors are partners, not customers to be managed.
- Acknowledge the author's concern before offering solutions.
- Be specific: use the actual numbers, dates and statuses from the FACTS block. No vague reassurance.
- If something is BookLeaf's fault (delayed royalty, ISBN error), own it directly. No corporate deflection.
- If it needs escalation or investigation, give a clear timeline (e.g. "Our team will look into this and get back to you within 48 hours").
- Always end with a clear next step for the author and/or the BookLeaf team.`;

const SECTIONS = {
  'Royalty & Payments': `Royalty policy:
- 80/20 split: 80% of net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. Below that, royalties roll over to the next quarter.
- Payouts are bank transfers to the account linked in the author's dashboard.
- Authors can see a detailed royalty breakdown (sales per platform) in their dashboard.`,

  'ISBN & Metadata Issues': `ISBN policy:
- Every book gets a unique ISBN assigned by BookLeaf, registered under BookLeaf's publisher imprint. An author who wants an ISBN under their own imprint must obtain it independently.
- An ISBN error (duplicate, wrong book linked, mismatch) is HIGH priority and is escalated to the production team.
Metadata: updates (e.g. book description) can be submitted via the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms in 3–5 business days.`,

  'Printing & Quality': `Printing & quality:
- In-house printing handles most orders; overflow or special formats go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): BookLeaf arranges a FREE reprint after verification. The author may need to share photos of the defective copy.`,

  'Distribution & Availability': `Distribution:
- Platforms: Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.
- New listings go live within 7–10 business days after publication is complete.
- A book showing as unavailable on a platform is usually a stock sync issue; the team can trigger a re-sync within 24–48 hours.`,

  'Book Status & Production Updates': `Production stages: Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
Authors are emailed at each stage. Delays usually happen at Cover Design (waiting for author approval) and Proofreading (revision rounds). Never blame the author for a delay, even if it is on their side; frame it collaboratively.`,

  'General Inquiry': `General: metadata updates (e.g. changing a book description after it is live) can be submitted through the dashboard or by emailing the BookLeaf team; changes usually reflect on platforms in 3–5 business days.`,
};

/** One calibrated example per category (few-shot, only the matching one is sent). */
const EXAMPLES = {
  'Royalty & Payments': {
    query: 'My royalty amount seems too low. I sold 200 copies but only received ₹3,000.',
    guidance: 'Explain the net-profit calculation (MRP minus printing, platform commission, shipping). Offer a line-by-line royalty breakdown. Do not be defensive; offer transparency. If payment is genuinely overdue, escalate with a 48-hour timeline.',
  },
  'ISBN & Metadata Issues': {
    query: 'My book shows a different ISBN on Amazon than the one on the physical copy.',
    guidance: 'High priority. Acknowledge it is a serious data issue, confirm escalation to the production team now, promise resolution within 48 hours.',
  },
  'Printing & Quality': {
    query: 'My author copies arrived with blurry images and misaligned pages.',
    guidance: 'Apologise sincerely. Ask for photos of the defective copies. Confirm a free reprint once verified, delivered in 5–7 business days.',
  },
  'Distribution & Availability': {
    query: 'My book is published but shows "Currently Unavailable" on Amazon.',
    guidance: 'Explain it is typically a stock sync issue, confirm you are triggering a re-sync with the distribution team, expect 24–48 hours.',
  },
  'Book Status & Production Updates': {
    query: "It's been 3 weeks and my book is still in typesetting. When will it be done?",
    guidance: 'Use the actual production status. If delayed, be honest about why and give a specific updated timeline, framed collaboratively.',
  },
  'General Inquiry': {
    query: 'Can I update my book description on Amazon after it is live?',
    guidance: 'Answer directly: yes, via the dashboard or by emailing the team; changes reflect in 3–5 business days.',
  },
};

function getContext(category) {
  const key = SECTIONS[category] ? category : 'General Inquiry';
  return { core: CORE, tone: TONE, policy: SECTIONS[key], example: EXAMPLES[key] };
}

module.exports = { getContext, SECTIONS };
