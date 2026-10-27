# Approach write-up

**What I prioritised.** The brief weights AI integration and architecture highest, so I built the core ticket loop end to end first (author submits, AI triages, admin gets a grounded draft, reply appears live), then hardened it: role-based access, validation, error shapes, and graceful degradation.

**AI design.** Two calls of very different weight. Triage sees only the ticket text and returns validated JSON in about 150 tokens. Drafting gets the persona and tone rules, only the policy section for the ticket's category, one calibration example and a compact facts block that code computes (the linked book's real figures, never-paid / below-₹1,000 flags, royalty-cycle dates). Letting code, not the model, do dates and numbers is what makes replies specific without invented figures. Drafts are generated lazily when an admin opens a ticket and cached, so cost scales with tickets handled, not tickets received.

**Reliability.** Ticket creation never depends on the AI. Failures (no key, outage, rate limit, bad output) fall back to a keyword triage and policy templates, flagged in the UI; a circuit breaker avoids slow requests during an outage. Admin overrides always win, even if they land while triage is still running.

**Trade-offs.** SQLite, an in-memory SSE hub and a vanilla-JS front end keep setup to `npm install && npm start` and reviewers can read every line. The cost is single-instance only and no upload storage. I chose SSE over WebSockets because updates only flow server-to-client; a 30s poll covers dropped streams.

**Product choices.** The urgency sort puts unresolved, higher-priority, older tickets first, and tickets over 72 hours old are marked red. Royalty screens explain *why* money is pending (below the ₹1,000 minimum, or no payout yet) and in-production books show an explanation instead of blank numbers. Replying claims an unassigned ticket.

**To production.** Postgres, Redis for SSE fan-out and rate limits, object storage for attachments, email notifications, SLA timers, provider prompt caching, and an eval set plus override logging to measure and improve classification accuracy.
