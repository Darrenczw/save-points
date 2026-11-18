// Save Points — spike 3: measure a full import (timings, sizes, sign-in lifetime).
//   deno run --allow-net --allow-read=. --allow-write=. measure.ts
import {
  exchangeRefreshTokenForAuthTokens, getUserPlayedGames, getUserTitles,
  getUserTrophiesForSpecificTitle, getUserTrophiesEarnedForTitle,
} from "npm:psn-api@2.18.1";

const t0 = performance.now();
const lap = (label: string, t: number) => console.log(`${label.padEnd(44)} ${((performance.now() - t) / 1000).toFixed(1)} s`);

let t = performance.now();
const auth = await exchangeRefreshTokenForAuthTokens((await Deno.readTextFile(".psn-refresh")).trim());
await Deno.writeTextFile(".psn-refresh", auth.refreshToken, { mode: 0o600 });
lap("sign-in (refresh token)", t);
console.log(`  access token lasts ${Math.round(auth.expiresIn / 60)} min, refresh token ${Math.round(auth.refreshTokenExpiresIn / 86400)} days`);

t = performance.now();
const played: any[] = [];
for (let off = 0; ; ) { const p = await getUserPlayedGames(auth, "me", { limit: 200, offset: off }); played.push(...p.titles); if (!p.nextOffset || p.nextOffset <= off) break; off = p.nextOffset; }
lap(`played games (${played.length})`, t);
const playedBytes = new TextEncoder().encode(JSON.stringify(played)).length;

t = performance.now();
const tt: any[] = [];
for (let off = 0; ; ) { const p = await getUserTitles(auth, "me", { limit: 800, offset: off }); tt.push(...p.trophyTitles); if (!p.nextOffset || p.nextOffset <= off) break; off = p.nextOffset; }
lap(`trophy title list (${tt.length})`, t);

const games = played.filter((x) => !/app/.test(x.category));
t = performance.now();
const map = new Map<string, any>();
const ids = games.map((g) => g.titleId);
const batches = []; for (let i = 0; i < ids.length; i += 5) batches.push(ids.slice(i, i + 5));
for (let i = 0; i < batches.length; i += 4) {
  await Promise.all(batches.slice(i, i + 4).map(async (b) => {
    try { const r = await getUserTrophiesForSpecificTitle(auth, "me", { npTitleIds: b.join(",") });
      for (const x of r.titles) if (x.trophyTitles?.[0]) map.set(x.npTitleId, x.trophyTitles[0]); } catch { /* skip */ }
  }));
}
lap(`titleId → trophy set map (${map.size} of ${ids.length}), 4 at a time`, t);

t = performance.now();
const sets = [...new Map([...map.values()].map((v) => [v.npCommunicationId, v])).values()];
let earned = 0, calls = 0;
for (let i = 0; i < sets.length; i += 6) {
  await Promise.all(sets.slice(i, i + 6).map(async (s) => {
    try { calls++; const r = await getUserTrophiesEarnedForTitle(auth, "me", s.npCommunicationId, "all", { npServiceName: s.npServiceName });
      earned += r.trophies.filter((x: any) => x.earned).length; } catch { /* skip */ }
  }));
}
lap(`earned trophies for ${sets.length} sets, 6 at a time`, t);
console.log(`  ${earned} earned trophies, ${calls} calls`);

// What we'd store per game (compact)
const compact = games.map((g) => ({ id: g.concept?.id, t: g.titleId, n: g.name, c: g.category, d: g.playDuration, f: g.firstPlayedDateTime, l: g.lastPlayedDateTime }));
console.log(`\nraw played-games JSON: ${(playedBytes / 1024).toFixed(0)} KB · compact game rows: ${(new TextEncoder().encode(JSON.stringify(compact)).length / 1024).toFixed(0)} KB`);
lap("TOTAL full import", t0);
const recent = tt.filter((x) => Date.now() - Date.parse(x.lastUpdatedDateTime) < 30 * 86400e3).length;
console.log(`trophy sets updated in the last 30 days (an incremental sync refetches only these): ${recent}`);
