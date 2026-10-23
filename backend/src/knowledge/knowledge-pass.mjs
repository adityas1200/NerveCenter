import { httpError } from '../lib/util.mjs';

// The weekly knowledge pass (SPEC-knowledge-07): an ordinary routine with a fixed name and objective, so it shows,
// runs, pauses and notifies like every other routine. The method lives in the knowledge-pass skill.

export const PASS_ROUTINE = 'knowledge-pass';
export const PASS_TITLE = 'Weekly knowledge pass';
export const PASS_OBJECTIVE = [
  'Run the weekly knowledge pass with the knowledge-pass skill.',
  '',
  "- Look back over the last 7 days of this project's tasks: where Sonic got stuck, was corrected or was blocked.",
  '- Merge duplicate drafts, list pages past their review date, check typed fields against the live systems and note changed source documents.',
  '- Run the knowledge-eval skill for every journey that has eval cases.',
  '- Draft fixes for clear gaps with origin "pass". Never keep or discard a draft: a person reviews them on the Knowledge page.',
  '- Record the digest once with record_knowledge_digest, then end with a two-line summary.',
].join('\n');
const DEFAULT_WEEKDAY = 1;
const DEFAULT_TIME = '07:00';
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Weekday and time from a weekly cron (`mm hh * * d`); defaults for anything else. */
export function scheduleOf(expression) {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/.exec(String(expression || '').trim());
  if (!match) return { weekday: DEFAULT_WEEKDAY, time: DEFAULT_TIME };
  return { weekday: Number(match[3]) % 7, time: `${match[2].padStart(2, '0')}:${match[1].padStart(2, '0')}` };
}

/** Pass state for the Knowledge page (FR-1): the routine's schedule and next run, plus the latest digest. */
export async function passState({ routines, journeys }) {
  const [routine, digest] = await Promise.all([routines ? routines.get(PASS_ROUTINE) : null, journeys.latestDigest()]);
  const { weekday, time } = scheduleOf(routine?.trigger?.expression);
  return {
    enabled: Boolean(routine && routine.enabled && routine.trigger?.type === 'schedule'),
    weekday, time,
    timezone: routine?.trigger?.timezone || null,
    routine: routine ? { name: routine.name, nextRunAt: routine.nextRunAt || null, lastRun: routine.lastRun || null, status: routine.status } : null,
    digest,
  };
}

/** Turn the pass on (save the routine) or off (pause it) (FR-2). */
export async function setPass({ routines, journeys }, { enabled, weekday, time } = {}, user) {
  if (!routines) throw httpError(400, 'Routines are not available here, so the weekly pass cannot run');
  if (typeof enabled !== 'boolean') throw httpError(400, 'Give enabled: true or false');
  if (weekday !== undefined && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw httpError(400, 'weekday must be 0 (Sunday) to 6 (Saturday)');
  if (time !== undefined && !TIME.test(String(time))) throw httpError(400, 'time must be HH:MM, for example 07:00');
  const existing = await routines.get(PASS_ROUTINE);
  if (!enabled) {
    if (existing) await routines.setEnabled(PASS_ROUTINE, false);
    return passState({ routines, journeys });
  }
  const current = scheduleOf(existing?.trigger?.expression);
  await routines.save({
    name: PASS_ROUTINE, title: PASS_TITLE, objective: PASS_OBJECTIVE,
    schedule: { kind: 'weekly', weekday: weekday ?? current.weekday, time: time ?? current.time, ...(existing?.trigger?.timezone ? { timezone: existing.trigger.timezone } : {}) },
    permission: 'policy', notify: 'on_complete', connections: existing?.connections || [], enabled: true, user,
  });
  return passState({ routines, journeys });
}
