/** Durable routine starts. Catch-up is bounded to the queue's seven-day retention window. */
export function routineJobSource({ routines, store } = {}) {
  if (!routines || !store) throw new TypeError('Routine jobs need routines and a job store');
  let cachedMinute = null;
  let cachedDue = [];
  return {
    maxAttempts: 1,
    catchUpLatestOnly: false,
    async dueJobs({ at }) {
      const minute = Math.floor(new Date(at).getTime() / 60_000);
      if (cachedMinute === minute) return cachedDue;
      const candidates = await routines.scheduledCandidates({ at, lookbackMinutes: 10_080, cursorFor: (projectId, name) => store.latest(projectId, 'routine', { routine: name }) });
      const due = [];
      for (const candidate of candidates) {
        const item = { projectId: candidate.projectId, slot: candidate.slot, dueAt: candidate.dueAt, payload: { routine: candidate.routine }, maxAttempts: 1 };
        if (candidate.skipped) await store.markSkipped({ ...item, source: 'routine' });
        else due.push(item);
      }
      cachedMinute = minute; cachedDue = due;
      return due;
    },
    async execute(job) { return routines.executeScheduled(job); },
  };
}
