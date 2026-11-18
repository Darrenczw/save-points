// Save Points — core logic shared by psn-sync and tests.
// Turns PSN "played games" + trophy dates into games and the years they belong to (PRD §7.5).

export type Label = "Played" | "Continued" | "Replayed" | "Brief visit";
export interface YearEntry { year: number; label: Label; isMain: boolean; share: number }

/** "PT228H56M33S" or "P1DT2H" -> hours */
export function hoursFromISO(iso: string | undefined | null): number {
  const m = (iso ?? "").match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 24 + Number(h ?? 0) + Number(mi ?? 0) / 60 + Number(s ?? 0) / 3600;
}

/** Tidy PSN names: ™ ®, "[PS2 emulation]", "Classic_", "PS4™ & PS5™", "(PlayStation®5)". */
export function cleanName(name: string): string {
  return name
    .replace(/[™®]/g, "")
    .replace(/\s*\[PS2 emulation\]/i, "")
    .replace(/^Classic_/, "")
    .replace(/\s+PS4 & PS5$/, "")
    .replace(/\s*\(PlayStation5\)/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface PlayedTitle {
  titleId: string; name: string; category: string; playDuration: string;
  firstPlayedDateTime: string; lastPlayedDateTime: string; playCount?: number; imageUrl?: string;
  concept?: { id?: number; media?: { images?: { type: string; url: string }[] } };
}
export interface MergedGame {
  conceptId: string; name: string; titleIds: string[]; platforms: string[];
  hours: number; first: string; last: string; playCount: number;
  cover: string | null; hero: string | null;
}

const img = (t: PlayedTitle, type: string) => t.concept?.media?.images?.find((i) => i.type === type)?.url ?? null;

/** Merge PS4/PS5 copies of one game (same concept), drop media apps. Dates are YYYY-MM-DD. */
export function mergePlayed(titles: PlayedTitle[]): MergedGame[] {
  const by = new Map<string, MergedGame>();
  for (const t of titles) {
    if (/app/i.test(t.category)) continue;
    const key = String(t.concept?.id ?? t.titleId);
    const first = t.firstPlayedDateTime.slice(0, 10), last = t.lastPlayedDateTime.slice(0, 10);
    const plat = /ps5/.test(t.category) ? "PS5" : /ps4/.test(t.category) ? "PS4" : "PS";
    const g = by.get(key) ?? {
      conceptId: key, name: cleanName(t.name), titleIds: [], platforms: [], hours: 0, first, last, playCount: 0,
      cover: img(t, "MASTER") ?? t.imageUrl ?? null, hero: img(t, "GAMEHUB_COVER_ART") ?? img(t, "BACKGROUND_LAYER_ART"),
    };
    g.titleIds.push(t.titleId);
    if (!g.platforms.includes(plat)) g.platforms.push(plat);
    g.hours += hoursFromISO(t.playDuration);
    g.playCount += t.playCount ?? 0;
    if (first < g.first) g.first = first;
    if (last > g.last) g.last = last;
    g.cover ??= img(t, "MASTER") ?? t.imageUrl ?? null;
    g.hero ??= img(t, "GAMEHUB_COVER_ART") ?? img(t, "BACKGROUND_LAYER_ART");
    by.set(key, g);
  }
  for (const g of by.values()) { g.platforms.sort(); g.hours = Math.round(g.hours * 100) / 100; }
  return [...by.values()];
}

/** Days of [first, last] that fall in a calendar year (inclusive). */
export function daysIn(first: string, last: string, year: number): number {
  const a = Date.parse(first), b = Date.parse(last);
  const s = Math.max(a, Date.UTC(year, 0, 1)), e = Math.min(b, Date.UTC(year, 11, 31));
  return e < s ? 0 : Math.round((e - s) / 86400000) + 1;
}

/**
 * Year labels (PRD §7.5). `trophies` maps year -> trophies earned that year.
 * `today` is YYYY-MM-DD; a game last played within 14 days is "now playing".
 */
export function labelYears(first: string, last: string, trophies: Record<number, number>, today: string): YearEntry[] {
  const fy = +first.slice(0, 4), ly = +last.slice(0, 4);
  const years = [...new Set([fy, ly, ...Object.keys(trophies).map(Number)])].sort((a, b) => a - b);
  const t = (y: number) => trophies[y] ?? 0;
  const total = years.reduce((n, y) => n + t(y), 0);
  const labels = new Map<number, Label>();
  let main: number;
  let weights: Map<number, number>;

  if (years.length === 1) {
    main = years[0]; labels.set(main, "Played"); weights = new Map([[main, 1]]);
  } else if (total >= 3) {
    main = years.reduce((best, y) => (t(y) > t(best) ? y : best), years[0]); // most trophies; earliest wins ties
    let lastSub: number | null = null;
    for (const y of years) {
      let l: Label;
      if (t(y) < 2) l = "Brief visit";
      else if (t(y) >= 5 && lastSub !== null && y - lastSub > 1) l = "Replayed";
      else if (t(y - 1) >= 2) l = "Continued";
      else l = "Played";
      if (t(y) >= 2) lastSub = y;
      labels.set(y, l);
    }
    weights = new Map(years.map((y) => [y, t(y) + 1]));
  } else {
    main = years.reduce((best, y) => (daysIn(first, last, y) > daysIn(first, last, best) ? y : best), years[0]);
    for (const y of years) labels.set(y, y === main ? "Played" : Math.abs(y - main) === 1 ? "Continued" : "Brief visit");
    weights = new Map(years.map((y) => [y, Math.max(1, daysIn(first, last, y))]));
  }

  // Never call what you're playing right now a brief visit.
  const nowYear = +today.slice(0, 4);
  const isNow = (Date.parse(today) - Date.parse(last)) / 86400000 <= 14;
  if (isNow && labels.get(nowYear) === "Brief visit") labels.set(nowYear, "Continued");

  const wsum = [...weights.values()].reduce((a, b) => a + b, 0);
  return years.map((y) => ({ year: y, label: labels.get(y)!, isMain: y === main, share: weights.get(y)! / wsum }));
}

/** Split total hours across years by share, rounded to 0.1 h, summing exactly to the total. */
export function splitHours(total: number, entries: YearEntry[]): Map<number, number> {
  const out = new Map<number, number>();
  let acc = 0;
  entries.forEach((e, i) => {
    const v = i === entries.length - 1 ? Math.round((total - acc) * 10) / 10 : Math.round(total * e.share * 10) / 10;
    acc += v; out.set(e.year, Math.max(0, v));
  });
  return out;
}
