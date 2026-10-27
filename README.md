# BookLeaf Author Support & Communication Portal

A two-sided web app (author portal + admin portal) where authors raise support tickets and the BookLeaf ops team triages and answers them faster with AI assistance: automatic **classification**, **priority scoring**, and **knowledge-base-grounded draft replies**. Admins can override every AI decision and always edit before sending. If the AI is unavailable, everything still works.

**Stack:** Node.js 18+ / Express 4, SQLite (better-sqlite3), JWT auth, zod validation, Server-Sent Events for live updates, vanilla-JS front end (no build step). LLM: Anthropic Claude Haiku by default, OpenAI supported via one env var.

---

## 1. Run it locally

```bash
npm install
cp .env.example .env        # then add ANTHROPIC_API_KEY (optional, see below)
npm start                   # http://localhost:3000
npm test                    # 9 tests (API + AI paths, no real API key needed)
```

The database is created and **seeded automatically** on first start from `data/bookleaf_sample_data.json` (10 authors, 18 books) plus 5 demo tickets. `npm run seed` wipes and re-seeds.

**No API key?** The app runs fully without one: triage uses a keyword rules engine and drafts come from policy templates. These are labelled "rules" / "Template draft" in the UI so admins know.

### Test accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookleaf.com` | `Admin@123` |
| Admin | `support@bookleaf.com` | `Admin@123` |
| Author | any author email from the dataset, e.g. `arzoo.rai@email.com` | `Author@123` |

Good edge-case authors to try: `ananya.reddy@email.com` (never paid), `kavita.deshmukh@email.com` (pending ₹850, below the ₹1,000 threshold, plus a book in typesetting), `sneha.kulkarni@email.com` (three books, one in cover design).

### Deploy
`Dockerfile` included. On Render/Railway: build `npm install`, start `npm start`, set `JWT_SECRET` and your LLM key. The SQLite file lives in `data/`; on ephemeral disks the app simply re-seeds on boot (mount a volume if you want tickets to persist).

---

## 2. Architecture

```
public/            Vanilla JS SPA (hash routing). Talks only to /api.
src/
  server.js        boot: seed-if-empty, listen
  app.js           express wiring, JSON 404s, central error handler
  config.js        all env access (API keys never leave the server)
  db.js            schema (6 tables) + pragmas
  middleware/      auth (JWT + role checks), validate (zod), rateLimit, errorHandler
  routes/          thin HTTP layer: auth, books, tickets (author), admin, events (SSE)
  services/
    tickets.js     all ticket SQL + serialisers (author view vs admin view)
    events.js      SSE hub
    ai/            llm.js (provider client) · prompts.js · knowledgeBase.js · facts.js · fallback.js · index.js (facade)
```

Key decisions:

- **Separation of concerns.** Routes validate and authorise; `services/tickets.js` owns SQL; `services/ai` owns everything LLM-related behind a facade (`triage`, `draftReply`) that *always* returns a usable result.
- **Authorisation by construction.** Authors never pass an `author_id`: it comes from the JWT. Other authors' tickets return **404** (not 403) so ids aren't enumerable. Internal notes live in a separate table and the author serialiser is an allow-list, so notes, priority, AI reasoning and drafts can't leak.
- **Ticket creation never waits on the AI.** `POST /tickets` inserts and returns 201; triage runs asynchronously and fills category/priority only if an admin hasn't overridden them in the meantime (`*_source = 'pending'` guard).
- **Real-time:** SSE (`/api/events`). Events carry only a ticket id; clients re-fetch via the normal authorised endpoints, so the stream can't leak data. EventSource can't set headers, so this one endpoint accepts `?access_token=` (trade-off noted below). A 30s poll is a safety net if the stream drops.
- **Schema:** `users`, `authors`, `books`, `tickets`, `ticket_messages`, `ticket_notes`. Books carry the dataset's royalty fields as given; "in production" books have NULLs (MRP, royalty) and the UI/AI handle that explicitly.

---

## 3. AI integration

**Two calls, deliberately different sizes**

| Call | When | Input | Output cap |
|---|---|---|---|
| Triage (category + priority + reason) | once per new ticket | ticket text + category/priority guide, **no KB, no history, no author data** (~400 tokens) | 150 tokens, JSON |
| Draft reply | lazily, when an admin opens an Open/In Progress ticket; cached on the ticket | persona + tone rules + **only the policy section for that category** + one calibration example + compact facts + last 4 messages | 450 tokens |

**Prompt strategy**
- The KB is split into sections (`knowledgeBase.js`); the draft prompt gets *core + tone + the one matching policy section + the matching sample Q→A guidance*. Roughly a quarter of the KB per call.
- **Facts are computed in code, not by the LLM** (`facts.js`): the linked book's real figures, `never_paid`, `below_payout_threshold`, and the royalty-cycle dates (quarter end + 45 days) so replies can state specific dates. If the ticket names a book, only that book is sent in full; other books are one-liners.
- Hard rules in the prompt: use only POLICY + FACTS, never invent numbers/dates, don't claim to have checked bank details or internal systems, handle null fields for books in production, own BookLeaf mistakes, give a 48h/24-48h/5-7 day timeline where policy says so, end with one next step, plain text 90-170 words.
- Triage output is parsed leniently (handles code fences) then **validated with zod**; anything off-schema is rejected. Business rule from the KB is enforced in code too: ISBN errors are never below High.

**Graceful degradation**
- Hung calls are bounded by a 20s timeout, with one retry with backoff on 429/5xx (no retry on other 4xx), and a **circuit breaker** (3 failures → skip the API for 60s) so an outage doesn't slow every request.
- On any failure (no key, outage, rate limit, invalid output, too-short draft): triage falls back to a keyword rules engine; drafts fall back to per-category policy templates filled with real figures. Tickets are always created, admins can always write manually. The UI labels the source ("AI" / "rules" / "Template draft").

**Cost awareness:** small, capped triage call; KB sliced per category; drafts generated lazily and cached (not per ticket, not per refresh); cache invalidated only when the thread or category changes; `max_tokens` caps on both calls; admin-draft endpoint rate-limited (20/min/user). Next step in production: provider prompt caching for the static system prefix.

**Model choice:** `claude-haiku-5-5` by default: fast and cheap, follows tight formatting/policy instructions well, which is what triage and short drafts need. Switch with `AI_PROVIDER=openai` (default model `gpt-4o-mini`) or override `AI_MODEL`. **API keys** are read from environment variables only (`.env` is git-ignored) and are used server-side only.

---

## 4. API reference

Base path `/api`. JSON in/out. Auth: `Authorization: Bearer <jwt>`. Errors share one shape:
`{"error": {"code": "VALIDATION_ERROR", "message": "...", "details": [{"field": "subject", "message": "..."}]}}`
(codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `INVALID_CREDENTIALS` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `TICKET_CLOSED` 409, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500)

| Method & path | Role | Description |
|---|---|---|
| `GET /health` | public | Liveness check |
| `POST /auth/login` | public | `{email, password}` → `{token, user}` (10/min/IP) |
| `GET /auth/me` | any | Current user |
| `GET /books` | any | Author: own books. Admin: all, or `?author_id=` |
| `GET /tickets` | author | Own tickets (status, no internal fields) |
| `POST /tickets` | author | `{book_id|null, subject(3-150), description(10-5000), attachment_name?}` → 201. `book_id` must belong to the author. Triggers async AI triage |
| `GET /tickets/:id` | author | Own ticket + messages (admin replies). 404 for others' tickets |
| `POST /tickets/:id/messages` | author | Follow-up `{body}`. Re-opens Resolved; 409 if Closed |
| `GET /admin/tickets` | admin | Queue. Filters: `status, category, priority, assigned=me\|unassigned, from, to (YYYY-MM-DD), q, sort=urgency\|oldest\|newest`. Default sort: unresolved first, then priority, then oldest |
| `GET /admin/tickets/:id` | admin | Ticket + author + book + messages + internal notes + cached draft |
| `PATCH /admin/tickets/:id` | admin | Any of `status, category, priority, assigned_to ("me" \| null)`. Category/priority overrides are marked `admin` and stick |
| `POST /admin/tickets/:id/draft` | admin | (Re)generate the AI draft → `{draft:{text, source: "ai"\|"template"}}`. Never 5xx on AI failure |
| `POST /admin/tickets/:id/reply` | admin | `{body, status}` → visible to the author instantly via SSE; claims the ticket if unassigned |
| `POST /admin/tickets/:id/notes` | admin | Internal note, never visible to authors |
| `GET /events` | any | SSE stream (`ticket.created`, `ticket.updated`); `?access_token=` allowed on this route only |

---

## 5. Known limitations / what I'd do next

- **Attachments are UI-only** (file name recorded, no upload/storage). Next: S3/R2 pre-signed uploads + virus scan.
- **`?access_token=` on the SSE URL** can appear in server logs. Next: short-lived single-use stream tickets, or cookie auth.
- **JWT in localStorage** is simple but XSS-sensitive (all user content is escaped, but httpOnly cookies + CSRF protection would be stronger).
- **SQLite + in-memory SSE hub and rate limiter** → single instance. Production: Postgres, Redis pub/sub for SSE fan-out, Redis rate limits.
- No password reset, no admin user management, no ticket SLA timers or email notifications (authors are only notified in-app).
- Triage accuracy is not benchmarked against a labelled set; I'd add an eval harness (50-100 labelled tickets) and log admin overrides as the feedback signal for prompt tuning.
- Royalty facts come from the seeded dataset; in production they'd be read from the royalty ledger, and bank-detail checks would be an explicit tool, not an LLM claim.
