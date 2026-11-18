// Save Points — PSN import spike.
// Proves we can pull played games + hours + dates from a real PSN account.
// Run with the NPSSO token in an env var (never hard-code it):
//   NPSSO=... deno run --allow-net --allow-env --allow-write=. psn-spike.ts
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserPlayedGames,
} from "npm:psn-api@2.18.1";

const npsso = Deno.env.get("NPSSO")?.trim();
if (!npsso) {
  console.error("No NPSSO token found.");
  Deno.exit(1);
}

// "PT228H56M33S" -> hours as a number
function hours(iso: string): number {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 24 + h + mi / 60 + s / 3600;
}

const code = await exchangeNpssoForAccessCode(npsso);
const auth = await exchangeAccessCodeForAuthTokens(code);
console.log("✓ Signed in. Refresh token lasts", Math.round(auth.refreshTokenExpiresIn / 86400), "days");

const all: any[] = [];
let offset = 0;
while (true) {
  const page = await getUserPlayedGames(auth, "me", { limit: 200, offset });
  all.push(...page.titles);
  if (!page.nextOffset || page.nextOffset <= offset) break;
  offset = page.nextOffset;
}

await Deno.writeTextFile("played.json", JSON.stringify(all, null, 2));

const rows = all
  .map((t) => ({
    name: t.name,
    cat: t.category,
    h: hours(t.playDuration),
    first: t.firstPlayedDateTime?.slice(0, 10),
    last: t.lastPlayedDateTime?.slice(0, 10),
    hasArt: Boolean(t.concept?.media?.images?.length || t.imageUrl),
  }))
  .sort((a, b) => b.h - a.h);

const years: Record<string, number> = {};
for (const r of rows) years[r.first?.slice(0, 4) ?? "?"] = (years[r.first?.slice(0, 4) ?? "?"] ?? 0) + 1;

console.log(`✓ ${rows.length} games found`);
console.log(`✓ ${rows.filter((r) => r.h > 0).length} have hours, ${rows.filter((r) => r.hasArt).length} have cover art`);
console.log("✓ Games by year first played:", years);
console.log("\nTop 15 by hours:");
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r.h.toFixed(1).padStart(6)} h  ${r.cat.padEnd(16)} ${r.first} → ${r.last}  ${r.name}`);
}
const dg = rows.find((r) => /days gone/i.test(r.name));
if (dg) console.log(`\nDays Gone check: ${dg.h.toFixed(1)} h, ${dg.first} → ${dg.last}`);
console.log("\nFull data saved to spike/played.json (stays on your Mac).");
