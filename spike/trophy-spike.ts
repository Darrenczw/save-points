// Save Points — spike 2: can trophy dates tell us the "main year" of a game?
// For each game played across more than one year, count trophies earned per year.
//   NPSSO=... deno run --allow-net --allow-env --allow-read=. --allow-write=. trophy-spike.ts
// After the first run, a refresh token is kept in spike/.psn-refresh (gitignored,
// readable only by you), so later runs don't need a new NPSSO. Delete it any time.
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getUserTrophiesForSpecificTitle,
  getUserTrophiesEarnedForTitle,
} from "npm:psn-api@2.18.1";

const REFRESH_FILE = ".psn-refresh";
async function signIn() {
  try {
    const rt = (await Deno.readTextFile(REFRESH_FILE)).trim();
    const a = await exchangeRefreshTokenForAuthTokens(rt);
    await Deno.writeTextFile(REFRESH_FILE, a.refreshToken, { mode: 0o600 });
    return a;
  } catch { /* fall through to NPSSO */ }
  const npsso = Deno.env.get("NPSSO")?.trim();
  if (!npsso) throw new Error("No saved sign-in and no NPSSO token given.");
  const a = await exchangeAccessCodeForAuthTokens(await exchangeNpssoForAccessCode(npsso));
  await Deno.writeTextFile(REFRESH_FILE, a.refreshToken, { mode: 0o600 });
  return a;
}

function hours(iso: string): number {
  const m = iso?.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 24 + h + mi / 60 + s / 3600;
}

const auth = await signIn();
console.log("✓ Signed in");

// Merge PS4/PS5 copies by concept, drop apps.
const played: any[] = JSON.parse(await Deno.readTextFile("played.json"));
const games = new Map<string, any>();
for (const t of played) {
  if (/app/.test(t.category)) continue;
  const key = String(t.concept?.id ?? t.titleId);
  const g = games.get(key) ?? { name: t.name, titleIds: [], h: 0, first: t.firstPlayedDateTime, last: t.lastPlayedDateTime };
  g.titleIds.push(t.titleId);
  g.h += hours(t.playDuration);
  if (t.firstPlayedDateTime < g.first) g.first = t.firstPlayedDateTime;
  if (t.lastPlayedDateTime > g.last) g.last = t.lastPlayedDateTime;
  games.set(key, g);
}
const multi = [...games.values()].filter((g) => g.h >= 1 && g.first.slice(0, 4) !== g.last.slice(0, 4));
console.log(`✓ ${games.size} games after merging; ${multi.length} (1 h+) span more than one year`);

// Map titleId -> trophy list id (5 per call).
const allIds = multi.flatMap((g) => g.titleIds);
const trophyIdFor = new Map<string, { id: string; svc: "trophy" | "trophy2" }>();
for (let i = 0; i < allIds.length; i += 5) {
  try {
    const r = await getUserTrophiesForSpecificTitle(auth, "me", { npTitleIds: allIds.slice(i, i + 5).join(",") });
    for (const t of r.titles) {
      const tt = t.trophyTitles?.[0];
      if (tt) trophyIdFor.set(t.npTitleId, { id: tt.npCommunicationId, svc: tt.npServiceName });
    }
  } catch (e) { console.log("  (lookup failed for a batch:", (e as Error).message, ")"); }
}

const out: any[] = [];
for (const g of multi) {
  const perYear: Record<string, number> = {};
  const seen = new Set<string>();
  for (const tid of g.titleIds) {
    const ref = trophyIdFor.get(tid);
    if (!ref || seen.has(ref.id)) continue;
    seen.add(ref.id);
    try {
      const r = await getUserTrophiesEarnedForTitle(auth, "me", ref.id, "all", { npServiceName: ref.svc });
      for (const tr of r.trophies) if (tr.earned && tr.earnedDateTime) {
        const y = tr.earnedDateTime.slice(0, 4);
        perYear[y] = (perYear[y] ?? 0) + 1;
      }
    } catch { /* no trophies for this one */ }
  }
  const total = Object.values(perYear).reduce((a, b) => a + b, 0);
  const main = total ? Object.entries(perYear).sort((a, b) => b[1] - a[1])[0][0] : null;
  out.push({ name: g.name, h: Math.round(g.h * 10) / 10, first: g.first.slice(0, 10), last: g.last.slice(0, 10), perYear, main });
}
out.sort((a, b) => b.h - a.h);
await Deno.writeTextFile("trophy-years.json", JSON.stringify(out, null, 2));

const withGuess = out.filter((o) => o.main).length;
console.log(`✓ Main year guessed from trophies for ${withGuess} of ${out.length} games\n`);
for (const o of out.slice(0, 30)) {
  const yrs = Object.entries(o.perYear).sort().map(([y, n]) => `${y}:${n}`).join(" ");
  console.log(`${String(o.h).padStart(6)} h  ${o.first} → ${o.last}  main=${o.main ?? "?   "}  [${yrs}]  ${o.name}`);
}
console.log("\nFull results saved to spike/trophy-years.json");
