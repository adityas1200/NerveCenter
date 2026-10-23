import path from 'node:path';
import { ensureDir, exists, readJson, writeJson } from './file-io.js';

// ADR-0005: the file-store twin of 010-ticket-events.sql. Each ticket's `activity` moves to
// `<runtimeDir>/ticket-events/<ticketId>.json`, then leaves the ticket. If an events file is already there (a crash
// between the two steps) it is kept as is and only `activity` is removed, so a second run changes nothing.
const eventsFile = (runtimeDir, ticketId) => path.join(runtimeDir, 'ticket-events', `${String(ticketId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

export async function up({ runtimeDir }) {
  const stateFile = path.join(runtimeDir, 'application-state.json');
  if (!(await exists(stateFile))) return;
  const state = await readJson(stateFile); let changed = false;
  for (const [key, ticket] of Object.entries(state.tickets || {})) {
    if (!ticket || typeof ticket !== 'object' || !('activity' in ticket)) continue;
    const ticketId = ticket.ticketId || key; const file = eventsFile(runtimeDir, ticketId);
    if (Array.isArray(ticket.activity) && ticket.activity.length && !(await exists(file))) {
      const events = ticket.activity.filter(event => event && typeof event === 'object').map((event, index) => ({ ...event, id: event.id || `${ticketId}-${index + 1}`, at: event.at || ticket.createdAt, type: event.type || 'ticket.event', ticketId, seq: index + 1 }));
      await ensureDir(path.dirname(file)); await writeJson(file, events);
    }
    delete ticket.activity; changed = true;
  }
  if (changed) await writeJson(stateFile, state);
}
