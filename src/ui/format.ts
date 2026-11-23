// Dates, times and sizes in words, in the browser's own locale and time zone.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** "4 minutes ago", "in 3 hours", "just now". */
export function relative(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const diff = now.getTime() - t;
  const abs = Math.abs(diff);
  let text: string;
  if (abs < MINUTE) return 'just now';
  if (abs < HOUR) text = plural(Math.round(abs / MINUTE), 'minute');
  else if (abs < DAY) text = plural(Math.round(abs / HOUR), 'hour');
  else if (abs < 60 * DAY) text = plural(Math.round(abs / DAY), 'day');
  else if (abs < 730 * DAY) text = plural(Math.round(abs / (30 * DAY)), 'month');
  else text = plural(Math.round(abs / (365 * DAY)), 'year');
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** "Nov 22, 2026, 2:04 PM". */
export function dateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A FHIR date or dateTime as a day: "Mar 5, 2026"; a partial date stays partial. */
export function dateText(d: string | undefined | null): string {
  if (!d) return 'No date';
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(d);
  if (!m) return d;
  const [, y, mo, da] = m;
  if (!mo) return y!;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, da ? Number(da) : 1));
  return date.toLocaleDateString(undefined, da ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' } : { year: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function yearOf(d: string | undefined): string {
  return d && /^\d{4}/.test(d) ? d.slice(0, 4) : 'No date';
}

export function bytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function duration(secs: number): string {
  if (secs < 3600) return plural(Math.round(secs / 60), 'minute');
  if (secs < 86400) return plural(Math.round(secs / 3600), 'hour');
  return plural(Math.round(secs / 86400), 'day');
}

export function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** The local calendar day of a moment, YYYY-MM-DD: for "has this visit happened". */
export function localDay(now: Date): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** When a coming moment falls: "now", "at 9:40 PM", "tomorrow at 4:04 PM", or the date and time. */
export function clock(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return 'at an unknown time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'at an unknown time';
  if (d.getTime() <= now.getTime()) return 'now';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = localDay(d);
  if (day === localDay(now)) return `at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day === localDay(tomorrow)) return `tomorrow at ${time}`;
  return `on ${dateTime(iso)}`;
}
