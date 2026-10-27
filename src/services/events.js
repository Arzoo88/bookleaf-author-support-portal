'use strict';
/**
 * Server-Sent Events hub — the "near real-time" layer.
 * Each connection is tagged with the user's id/role. Events carry only ids, never ticket
 * content, so a client always re-fetches through the normal authorised REST endpoints.
 */
const clients = new Set();

function addClient(res, user) {
  const client = { res, user };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

/** Notify all admins, plus the owning author (if any). */
function publish(type, { ticketId, authorId }) {
  const payload = `event: ${type}\ndata: ${JSON.stringify({ ticketId })}\n\n`;
  for (const { res, user } of clients) {
    if (user.role === 'admin' || (authorId && user.author_id === authorId)) res.write(payload);
  }
}
module.exports = { addClient, publish };
