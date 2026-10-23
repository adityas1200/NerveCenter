// A small five-field cron matcher with timezone support. Enough for routines: minute, hour,
// day of month, month, day of week; `*`, lists, ranges and steps. No seconds, no @-aliases.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'weekday', min: 0, max: 6 },
];
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseValue(token, field) {
  const lower = String(token).toLowerCase();
  if (field.name === 'weekday' && lower in WEEKDAYS) return WEEKDAYS[lower];
  if (field.name === 'month' && lower in MONTHS) return MONTHS[lower];
  const value = Number(token);
  if (!Number.isInteger(value)) throw new Error(`Invalid cron value "${token}" for ${field.name}`);
  if (field.name === 'weekday' && value === 7) return 0;
  if (value < field.min || value > field.max) throw new Error(`Cron ${field.name} ${value} is out of range ${field.min}-${field.max}`);
  return value;
}

function parseField(spec, field) {
  const allowed = new Set();
  for (const part of String(spec).split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step "${stepPart}" for ${field.name}`);
    let start; let end;
    if (rangePart === '*' || rangePart === '?') { start = field.min; end = field.max; }
    else if (rangePart.includes('-')) { const [a, b] = rangePart.split('-'); start = parseValue(a, field); end = parseValue(b, field); if (end < start) throw new Error(`Cron range "${rangePart}" runs backwards for ${field.name}`); }
    else { start = parseValue(rangePart, field); end = stepPart === undefined ? start : field.max; }
    for (let value = start; value <= end; value += step) allowed.add(value);
  }
  return allowed;
}

export function parseCron(expression) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression needs five fields: minute hour day month weekday');
  return { expression: parts.join(' '), fields: FIELDS.map((field, index) => parseField(parts[index], field)) };
}

/** Wall-clock parts of `date` in `timezone`. */
function zonedParts(date, timezone) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', hourCycle: 'h23', minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', year: 'numeric', weekday: 'short' }); }
  catch { throw new Error(`Unknown timezone: ${timezone}`); }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return { minute: Number(parts.minute), hour: Number(parts.hour) % 24, day: Number(parts.day), month: Number(parts.month), year: Number(parts.year), weekday: WEEKDAYS[String(parts.weekday).toLowerCase().slice(0, 3)] };
}

export function matchesCron(parsed, date, timezone) {
  const at = zonedParts(date, timezone);
  const [minute, hour, day, month, weekday] = parsed.fields;
  return minute.has(at.minute) && hour.has(at.hour) && day.has(at.day) && month.has(at.month) && weekday.has(at.weekday);
}

/** Next matching minute strictly after `from`, scanning up to `horizonMinutes`. */
export function nextRun(expression, timezone, from = new Date(), horizonMinutes = 60 * 24 * 400) {
  const parsed = typeof expression === 'string' ? parseCron(expression) : expression;
  const start = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < horizonMinutes; i += 1) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (matchesCron(parsed, candidate, timezone)) return candidate;
  }
  return null;
}

/** A sentence for the schedule: "Every weekday at 9:00 AM", "Fridays at 4:00 PM", "Every 2 hours", or the raw cron. */
export function describeCron(expression, timezone) {
  let parsed; try { parsed = parseCron(expression); } catch { return String(expression || 'Not scheduled'); }
  const parts = parsed.expression.split(' ');
  const [minute, hour, day, month, weekday] = parts;
  const time = () => { const h = Number(hour); const m = Number(minute); if (!Number.isInteger(h) || !Number.isInteger(m)) return null; const suffix = h >= 12 ? 'PM' : 'AM'; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}:${String(m).padStart(2, '0')} ${suffix}`; };
  const zone = timezone && timezone !== 'UTC' ? ` (${timezone})` : '';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (month === '*' && day === '*' && time()) {
    if (weekday === '*') return `Every day at ${time()}${zone}`;
    if (weekday === '1-5') return `Every weekday at ${time()}${zone}`;
    const days = [...parsed.fields[4]].sort().map(index => names[index]);
    if (days.length === 1) return `${days[0]}s at ${time()}${zone}`;
    return `${days.join(', ')} at ${time()}${zone}`;
  }
  if (month === '*' && weekday === '*' && time() && /^\d+$/.test(day)) return `Day ${day} of every month at ${time()}${zone}`;
  if (minute === '0' && hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') return `Every ${hour.slice(2)} hours`;
  if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') return `Every ${minute.slice(2)} minutes`;
  return parsed.expression;
}

/** Build a cron from the form: kind weekday|daily|weekly|monthly|hours, time "HH:MM", weekday 0-6, dayOfMonth 1-31, everyHours n. */
export function cronFromSchedule({ kind, time = '09:00', weekday = 1, dayOfMonth = 1, everyHours = 2 } = {}) {
  const [hh, mm] = String(time).split(':').map(Number);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) throw new Error('time must be HH:MM');
  switch (kind) {
    case 'weekday': return `${mm} ${hh} * * 1-5`;
    case 'daily': return `${mm} ${hh} * * *`;
    case 'weekly': return `${mm} ${hh} * * ${Number(weekday) % 7}`;
    case 'monthly': return `${mm} ${hh} ${Math.max(1, Math.min(31, Number(dayOfMonth) || 1))} * *`;
    case 'hours': return `0 */${Math.max(1, Math.min(23, Number(everyHours) || 2))} * * *`;
    default: throw new Error('Unknown schedule kind');
  }
}
