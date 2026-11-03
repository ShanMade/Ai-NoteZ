/** Words in a note body. Counts Latin-style words and CJK/Urdu-style runs as whole tokens. */
export function countWords(text: string): number {
  const trimmed = text.replace(/[#*_`>\-[\]()!|]/g, " ").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/** Whole minutes to read, at roughly 220 words per minute. Never less than one for a non-empty note. */
export function readingMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.round(words / 220));
}

/** "just now", "5 minutes ago", "yesterday", "3 days ago" in the given locale. */
export function relativeTime(iso: string, locale?: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 45) return formatter.format(0, "second");
  if (abs < 45 * 60) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 22 * 3600) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 6 * 86400) return formatter.format(Math.round(seconds / 86400), "day");
  return new Date(then).toLocaleDateString(locale, { month: "short", day: "numeric" });
}
