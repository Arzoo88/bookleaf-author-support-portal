'use strict';
/* BookLeaf Author Support portal — vanilla JS SPA (hash routing). No build step. */

const CATEGORIES = ['Royalty & Payments', 'ISBN & Metadata Issues', 'Printing & Quality',
  'Distribution & Availability', 'Book Status & Production Updates', 'General Inquiry'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const STALE_HOURS = 72;

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN'));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const chip = (s) => `<span class="chip ${esc(s).replace(/ /g, '-')}">${esc(s)}</span>`;
const hoursOld = (d) => (Date.now() - new Date(d)) / 36e5;
const age = (d) => { const h = hoursOld(d); return h < 1 ? '<1h' : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`; };
const options = (list, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') +
  list.map((o) => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');
const sourceTag = (s) => ({ ai: 'AI', rules: 'rules', admin: 'overridden', pending: 'triaging…' }[s] ? `<span class="tag">${{ ai: 'AI', rules: 'rules', admin: 'overridden', pending: 'triaging…' }[s]}</span>` : '');

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const errMsg = (e) => (e.details?.length ? e.details.map((d) => d.message).join(' · ') : e.message);

/* ---------- session + API ---------- */
const session = { token: localStorage.getItem('bl_token'), user: JSON.parse(localStorage.getItem('bl_user') || 'null') };

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(session.token ? { authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && session.token) logout();
    const e = new Error(data.error?.message || 'Request failed');
    e.details = data.error?.details;
    throw e;
  }
  return data;
}

function logout() {
  localStorage.removeItem('bl_token'); localStorage.removeItem('bl_user');
  session.token = null; session.user = null;
  closeEvents(); location.hash = ''; render();
}

/* ---------- real-time (SSE, with slow polling as a safety net) ---------- */
let es = null, liveOn = false, refreshHandler = null, debounce = null, poll = null;
function setLive(on) { liveOn = on; const d = $('#live'); if (d) d.classList.toggle('off', !on); }
function triggerRefresh() {
  clearTimeout(debounce);
  debounce = setTimeout(() => refreshHandler && refreshHandler().catch(() => {}), 200);
}
function openEvents() {
  closeEvents();
  es = new EventSource('/api/events?access_token=' + encodeURIComponent(session.token));
  es.addEventListener('ready', () => setLive(true));
  es.addEventListener('ticket.created', triggerRefresh);
  es.addEventListener('ticket.updated', triggerRefresh);
  es.onerror = () => setLive(false);
  poll = setInterval(triggerRefresh, 30000);
}
function closeEvents() { if (es) es.close(); es = null; clearInterval(poll); setLive(false); }

/* ---------- shell + router ---------- */
const app = $('#app');

function shell(inner, active) {
  const nav = session.user.role === 'admin'
    ? [['#/queue', 'Ticket queue']]
    : [['#/books', 'My books'], ['#/new', 'Submit a query'], ['#/tickets', 'My tickets']];
  app.innerHTML = `
    <header class="topbar">
      <span class="brand">BookLeaf</span>
      <nav>${nav.map(([h, l]) => `<a href="${h}" class="${active === h ? 'active' : ''}">${l}</a>`).join('')}</nav>
      <div class="who"><span id="live" class="live ${liveOn ? '' : 'off'}" title="Live updates"></span>
        ${esc(session.user.name)} (${session.user.role})
        <button class="btn ghost small" id="logout" style="color:#fff;border-color:#7fd1a8">Log out</button></div>
    </header>
    <main>${inner}</main>`;
  $('#logout').onclick = logout;
}

const panelError = (e) => `<div class="panel empty"><p>${esc(errMsg(e))}</p></div>`;

async function render() {
  refreshHandler = null;
  if (!session.token) return viewLogin();
  if (!es) openEvents();
  const [, page, id] = (location.hash || '').split('/');
  const admin = session.user.role === 'admin';
  try {
    if (admin) {
      if (page === 'queue' && id) return await viewAdminTicket(Number(id));
      if (page === 'queue') return await viewQueue();
      location.hash = '#/queue';
    } else {
      if (page === 'tickets' && id) return await viewTicket(Number(id));
      if (page === 'tickets') return await viewTickets();
      if (page === 'new') return await viewNew();
      if (page === 'books') return await viewBooks();
      location.hash = '#/books';
    }
  } catch (e) {
    if (session.token) { shell('', ''); $('main').innerHTML = panelError(e); }
  }
}
window.addEventListener('hashchange', render);

/* ---------- login ---------- */
function viewLogin() {
  closeEvents();
  app.innerHTML = `
    <div class="panel login">
      <h1>BookLeaf</h1><p class="sub">Author support portal</p>
      <form id="f">
        <label for="email">Email</label><input id="email" type="email" required autocomplete="username">
        <label for="pw">Password</label><input id="pw" type="password" required autocomplete="current-password">
        <p class="err" id="err" hidden></p>
        <p><button class="btn" style="width:100%">Log in</button></p>
      </form>
      <div class="demo"><strong>Demo accounts</strong><br>
        Author: arzoo.rai@email.com / Author@123<br>
        Admin: admin@bookleaf.com / Admin@123</div>
    </div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const { token, user } = await api('POST', '/auth/login', { email: $('#email').value, password: $('#pw').value });
      session.token = token; session.user = user;
      localStorage.setItem('bl_token', token); localStorage.setItem('bl_user', JSON.stringify(user));
      location.hash = ''; render();
    } catch (e) { const el = $('#err'); el.textContent = errMsg(e); el.hidden = false; }
  };
}

/* =====================  AUTHOR  ===================== */
async function viewBooks() {
  shell(`<div class="page-head"><div><h1>My books</h1><p class="sub">Sales and royalty details for your titles.</p></div></div><div id="c">Loading…</div>`, '#/books');
  const { books } = await api('GET', '/books');
  $('#c').innerHTML = books.length ? `<div class="grid">${books.map(bookCard).join('')}</div>`
    : `<div class="panel empty"><p>No books on your account yet.</p></div>`;
}

function bookCard(b) {
  const facts = b.in_production
    ? `<dl class="facts"><dt>ISBN</dt><dd>${esc(b.isbn)}</dd><dt>Genre</dt><dd>${esc(b.genre)}</dd><dt>Publication date</dt><dd>Not yet published</dd></dl>
       <div class="note">This book is still in production. Pricing, sales and royalties appear here once it is live.</div>`
    : `<dl class="facts">
        <dt>ISBN</dt><dd>${esc(b.isbn)}</dd><dt>Genre</dt><dd>${esc(b.genre)}</dd>
        <dt>Published</dt><dd>${fmtDate(b.publication_date)}</dd><dt>MRP</dt><dd>${money(b.mrp)}</dd>
        <dt>Copies sold</dt><dd>${b.total_copies_sold.toLocaleString('en-IN')}</dd>
        <dt>Royalty earned</dt><dd>${money(b.total_royalty_earned)}</dd>
        <dt>Royalty paid</dt><dd>${money(b.royalty_paid)}</dd>
        <dt>Royalty pending</dt><dd><strong>${money(b.royalty_pending)}</strong></dd>
        <dt>Last payout</dt><dd>${b.last_royalty_payout_date ? fmtDate(b.last_royalty_payout_date) : 'No payout yet'}</dd>
        <dt>Available on</dt><dd>${esc(b.available_on.join(', ') || '—')}</dd></dl>
       ${b.below_payout_threshold ? `<div class="note">Your pending royalty is below the ₹1,000 minimum payout, so it rolls over to the next quarter.</div>` : ''}
       ${b.royalty_pending > 0 && !b.last_royalty_payout_date && !b.below_payout_threshold ? `<div class="note">No payout has been made yet. Royalties are calculated quarterly and paid within 45 days of quarter end. <a href="#/new">Ask us about it</a>.</div>` : ''}`;
  return `<article class="panel"><div class="book-head"><h2>${esc(b.title)}</h2>${chip(b.status)}</div>${facts}</article>`;
}

async function viewNew() {
  shell(`<div class="page-head"><div><h1>Submit a support query</h1><p class="sub">Our team usually responds within 48 hours.</p></div></div><div id="c" class="panel" style="max-width:720px">Loading…</div>`, '#/new');
  const { books } = await api('GET', '/books');
  $('#c').innerHTML = `<form id="f">
    <label for="book">Which book is this about?</label>
    <select id="book"><option value="">General / Account Level</option>${books.map((b) => `<option value="${esc(b.book_id)}">${esc(b.title)}</option>`).join('')}</select>
    <label for="subject">Subject</label><input id="subject" type="text" maxlength="150" required placeholder="e.g. Royalty for Q3 not received">
    <label for="desc">Describe the issue</label><textarea id="desc" required minlength="10" maxlength="5000" placeholder="Include dates, amounts or platform names where relevant."></textarea>
    <label for="file">Attachment (optional)</label><input id="file" type="file">
    <p class="hint">Only the file name is recorded for now; file upload is not enabled yet.</p>
    <p class="err" id="err" hidden></p>
    <p><button class="btn" id="go">Submit query</button></p></form>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('#go'); btn.disabled = true;
    try {
      const { ticket } = await api('POST', '/tickets', {
        book_id: $('#book').value || null, subject: $('#subject').value, description: $('#desc').value,
        attachment_name: $('#file').files[0]?.name || null,
      });
      toast('Query submitted'); location.hash = `#/tickets/${ticket.id}`;
    } catch (e) { const el = $('#err'); el.textContent = errMsg(e); el.hidden = false; btn.disabled = false; }
  };
}

async function viewTickets() {
  shell(`<div class="page-head"><div><h1>My tickets</h1><p class="sub">Updates appear here automatically.</p></div><a class="btn" href="#/new">New query</a></div><div id="c">Loading…</div>`, '#/tickets');
  const load = async () => {
    const { tickets } = await api('GET', '/tickets');
    $('#c').innerHTML = tickets.length ? `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Book</th><th>Status</th><th>Last update</th></tr></thead><tbody>
      ${tickets.map((t) => `<tr data-id="${t.id}"><td><a href="#/tickets/${t.id}"><strong>#${t.id}</strong> ${esc(t.subject)}</a></td>
        <td>${esc(t.book_title || 'General / Account Level')}</td><td>${chip(t.status)}</td><td>${fmtTime(t.updated_at)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="panel empty"><p>You haven't raised any queries yet.</p><p><a class="btn" href="#/new">Submit your first query</a></p></div>`;
    $('#c').querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = (e) => { if (e.target.tagName !== 'A') location.hash = `#/tickets/${tr.dataset.id}`; }; });
  };
  refreshHandler = load; await load();
}

const message = (role, who, when, body) =>
  `<div class="msg ${role === 'admin' ? 'admin' : ''}"><div class="meta">${esc(who)} · ${fmtTime(when)}</div><div class="body">${esc(body)}</div></div>`;

async function viewTicket(id) {
  shell(`<p><a href="#/tickets">← My tickets</a></p><div id="head"></div><div id="thread"></div><div id="follow"></div>`, '#/tickets');
  const load = async () => {
    const { ticket: t } = await api('GET', `/tickets/${id}`);
    $('#head').innerHTML = `<div class="page-head"><div><h1>#${t.id} ${esc(t.subject)}</h1>
      <p class="sub">${esc(t.book_title || 'General / Account Level')} · opened ${fmtTime(t.created_at)}${t.attachment_name ? ` · attachment: ${esc(t.attachment_name)}` : ''}</p></div>${chip(t.status)}</div>`;
    $('#thread').innerHTML = message('author', 'You', t.created_at, t.description)
      + t.messages.map((m) => message(m.sender_role, m.sender_role === 'admin' ? 'BookLeaf Support' : 'You', m.created_at, m.body)).join('')
      + (t.messages.some((m) => m.sender_role === 'admin') ? '' : `<p class="hint">Waiting for a reply from the BookLeaf team. This page updates automatically.</p>`);

    const f = $('#follow'); const closed = t.status === 'Closed';
    if (f.dataset.closed !== String(closed)) { // rebuild only when needed so a half-typed reply isn't wiped
      f.dataset.closed = String(closed);
      f.innerHTML = closed ? `<p class="hint">This ticket is closed. <a href="#/new">Submit a new query</a> if you need more help.</p>`
        : `<form class="panel" id="ff"><label for="fb" style="margin-top:0">Add a follow-up</label><textarea id="fb" maxlength="5000" required></textarea><p class="err" id="err" hidden></p><p><button class="btn">Send</button></p></form>`;
      if (!closed) $('#ff').onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api('POST', `/tickets/${id}/messages`, { body: $('#fb').value }); $('#fb').value = ''; toast('Sent'); await load(); }
        catch (e) { const el = $('#err'); el.textContent = errMsg(e); el.hidden = false; }
      };
    }
  };
  refreshHandler = load; await load();
}

/* =====================  ADMIN  ===================== */
const filters = { sort: 'urgency' };

async function viewQueue() {
  shell(`<div class="page-head"><div><h1>Ticket queue</h1><p class="sub" id="summary"></p></div></div>
    <div class="filters panel">
      <div><label>Status</label><select data-f="status">${options(STATUSES, filters.status, 'All')}</select></div>
      <div><label>Category</label><select data-f="category">${options(CATEGORIES, filters.category, 'All')}</select></div>
      <div><label>Priority</label><select data-f="priority">${options(PRIORITIES, filters.priority, 'All')}</select></div>
      <div><label>Assigned</label><select data-f="assigned"><option value="">Anyone</option><option value="me" ${filters.assigned === 'me' ? 'selected' : ''}>Me</option><option value="unassigned" ${filters.assigned === 'unassigned' ? 'selected' : ''}>Unassigned</option></select></div>
      <div><label>From</label><input type="date" data-f="from" value="${esc(filters.from || '')}"></div>
      <div><label>To</label><input type="date" data-f="to" value="${esc(filters.to || '')}"></div>
      <div><label>Search</label><input type="text" data-f="q" placeholder="Subject or author" value="${esc(filters.q || '')}"></div>
      <div><label>Sort</label><select data-f="sort"><option value="urgency">Most urgent first</option><option value="oldest" ${filters.sort === 'oldest' ? 'selected' : ''}>Oldest first</option><option value="newest" ${filters.sort === 'newest' ? 'selected' : ''}>Newest first</option></select></div>
    </div><div id="c">Loading…</div>`, '#/queue');

  const load = async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    const { tickets } = await api('GET', '/admin/tickets' + (qs ? `?${qs}` : ''));
    const open = tickets.filter((t) => !['Resolved', 'Closed'].includes(t.status));
    const urgent = open.filter((t) => ['Critical', 'High'].includes(t.priority)).length;
    $('#summary').textContent = `${tickets.length} tickets · ${open.length} unresolved · ${urgent} critical/high`;
    $('#c').innerHTML = tickets.length ? `<div class="table-wrap"><table><thead><tr><th>Priority</th><th>Ticket</th><th>Category</th><th>Status</th><th>Assignee</th><th>Age</th></tr></thead><tbody>
      ${tickets.map((t) => {
        const done = ['Resolved', 'Closed'].includes(t.status);
        return `<tr class="p-${t.priority} ${done ? 'done' : ''}" data-id="${t.id}">
          <td><span class="pri ${t.priority}">${t.priority}</span>${sourceTag(t.priority_source)}</td>
          <td><strong>#${t.id} ${esc(t.subject)}</strong><br><span class="hint">${esc(t.author_name)} · ${esc(t.book_title || 'General / Account Level')}</span></td>
          <td>${esc(t.category)}${sourceTag(t.category_source)}</td><td>${chip(t.status)}</td><td>${esc(t.assignee_name || '—')}</td>
          <td class="${!done && hoursOld(t.created_at) > STALE_HOURS ? 'stale' : ''}">${age(t.created_at)}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="panel empty"><p>No tickets match these filters.</p></div>`;
    $('#c').querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => { location.hash = `#/queue/${tr.dataset.id}`; }; });
  };
  document.querySelectorAll('[data-f]').forEach((el) => {
    el.onchange = () => { filters[el.dataset.f] = el.value || undefined; load().catch((e) => toast(errMsg(e))); };
  });
  refreshHandler = load; await load();
}

async function viewAdminTicket(id) {
  shell(`<p><a href="#/queue">← Ticket queue</a></p><div id="head"></div>
    <div class="cols"><div><div id="thread"></div><div id="composer"></div></div>
    <aside><div id="meta" class="panel"></div><div class="panel" style="margin-top:1rem"><h3>Internal notes</h3><p class="hint">Not visible to the author.</p><div id="noteList"></div>
      <textarea id="noteBody" style="min-height:70px" maxlength="2000"></textarea><p><button class="btn small" id="addNote">Add note</button></p></div></aside></div>`, '#/queue');

  let current = null;
  const load = async () => {
    const { ticket: t, ai_enabled } = await api('GET', `/admin/tickets/${id}`);
    current = t;
    $('#head').innerHTML = `<div class="page-head"><div><h1>#${t.id} ${esc(t.subject)}</h1><p class="sub">${esc(t.author.name)} · ${esc(t.book_title || 'General / Account Level')} · opened ${fmtTime(t.created_at)} (${age(t.created_at)} ago)</p></div>${chip(t.status)}</div>`;
    $('#thread').innerHTML = message('author', t.author.name, t.created_at, t.description)
      + t.messages.map((m) => message(m.sender_role, m.sender_name, m.created_at, m.body)).join('');
    const b = t.book;
    $('#meta').innerHTML = `
      <h3>Triage</h3>
      <label>Status</label><select id="sStatus">${options(STATUSES, t.status)}</select>
      <label>Category ${sourceTag(t.category_source)}</label><select id="sCat">${options(CATEGORIES, t.category)}</select>
      <label>Priority ${sourceTag(t.priority_source)}</label><select id="sPri">${options(PRIORITIES, t.priority)}</select>
      ${t.triage_reason ? `<p class="hint">Reason: ${esc(t.triage_reason)}</p>` : ''}
      <p class="row"><span class="hint">Assignee: ${esc(t.assignee_name || 'unassigned')}</span>
        ${t.assignee_name && t.assigned_to === session.user.id ? '<button class="btn ghost small" id="unassign">Unassign</button>' : '<button class="btn ghost small" id="assign">Assign to me</button>'}</p>
      <hr style="border:0;border-top:1px solid var(--line)">
      <h3>Author</h3><dl class="facts"><dt>Name</dt><dd>${esc(t.author.name)}</dd><dt>Email</dt><dd>${esc(t.author.email)}</dd><dt>Phone</dt><dd>${esc(t.author.phone)}</dd><dt>City</dt><dd>${esc(t.author.city)}</dd></dl>
      ${b ? `<h3 style="margin-top:1rem">Book</h3><dl class="facts"><dt>Title</dt><dd>${esc(b.title)}</dd><dt>Status</dt><dd>${esc(b.status)}</dd><dt>Copies sold</dt><dd>${b.total_copies_sold}</dd><dt>Royalty paid</dt><dd>${money(b.royalty_paid)}</dd><dt>Royalty pending</dt><dd>${money(b.royalty_pending)}</dd><dt>Last payout</dt><dd>${b.last_royalty_payout_date ? fmtDate(b.last_royalty_payout_date) : 'None'}</dd></dl>` : ''}`;
    const patch = async (body) => { try { await api('PATCH', `/admin/tickets/${id}`, body); toast('Updated'); await load(); } catch (e) { toast(errMsg(e)); } };
    $('#sStatus').onchange = (e) => patch({ status: e.target.value });
    $('#sCat').onchange = (e) => patch({ category: e.target.value });
    $('#sPri').onchange = (e) => patch({ priority: e.target.value });
    const a = $('#assign'), u = $('#unassign');
    if (a) a.onclick = () => patch({ assigned_to: 'me' });
    if (u) u.onclick = () => patch({ assigned_to: null });
    $('#noteList').innerHTML = t.notes.length ? t.notes.map((n) => `<div class="note-item">${esc(n.body)}<div class="meta">${esc(n.admin_name)} · ${fmtTime(n.created_at)}</div></div>`).join('') : '<p class="hint">No notes yet.</p>';
    if (!$('#composer').dataset.init) buildComposer(t, ai_enabled);
    else if (current.draft && !$('#reply').value) setDraft(current.draft); // draft arrived from another tab/session
  };

  /* Composer is built once so live refreshes never overwrite what the admin is typing. */
  let lastDraftText = '';
  const setDraft = (d) => {
    lastDraftText = d.text; $('#reply').value = d.text; $('#regen').textContent = 'Regenerate draft';
    $('#draftTag').textContent = d.source === 'ai' ? 'AI draft: review before sending' : 'Template draft: AI unavailable, please review';
  };
  const genDraft = async () => {
    const reply = $('#reply'), btn = $('#regen');
    if (reply.value.trim() && reply.value !== lastDraftText && !confirm('Replace your edits with a new draft?')) return;
    btn.disabled = true; reply.placeholder = 'Drafting a reply from the knowledge base…';
    try { const { draft } = await api('POST', `/admin/tickets/${id}/draft`); setDraft(draft); }
    catch (e) { toast(errMsg(e)); } finally { btn.disabled = false; reply.placeholder = 'Write your reply…'; }
  };
  function buildComposer(t, aiEnabled) {
    const c = $('#composer'); c.dataset.init = '1';
    c.innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><h3>Reply to author</h3><span class="tag" id="draftTag"></span></div>
      <textarea id="reply" placeholder="Write your reply…" style="min-height:220px"></textarea>
      ${aiEnabled ? '' : '<p class="hint">AI is not configured on this server: drafts come from policy templates.</p>'}
      <p class="err" id="err" hidden></p>
      <div class="row"><button class="btn ghost small" id="regen">${t.draft ? 'Regenerate draft' : 'Generate draft'}</button><span style="flex:1"></span>
        <label style="margin:0">After sending</label><select id="after" style="width:auto">${options(['In Progress', 'Resolved', 'Closed'], 'In Progress')}</select>
        <button class="btn" id="send">Send reply</button></div></div>`;
    $('#regen').onclick = genDraft;
    $('#send').onclick = async () => {
      const body = $('#reply').value.trim(); if (!body) return;
      $('#send').disabled = true;
      try {
        await api('POST', `/admin/tickets/${id}/reply`, { body, status: $('#after').value });
        $('#reply').value = ''; lastDraftText = ''; $('#draftTag').textContent = ''; toast('Reply sent'); await load();
      } catch (e) { const el = $('#err'); el.textContent = errMsg(e); el.hidden = false; } finally { $('#send').disabled = false; }
    };
    if (t.draft) setDraft(t.draft);
    else if (['Open', 'In Progress'].includes(t.status)) genDraft(); // auto-draft on open (lazy + cached => cost-aware)
  }
  $('#addNote').onclick = async () => {
    const body = $('#noteBody').value.trim(); if (!body) return;
    try { await api('POST', `/admin/tickets/${id}/notes`, { body }); $('#noteBody').value = ''; await load(); } catch (e) { toast(errMsg(e)); }
  };
  refreshHandler = load; await load();
}

render();
