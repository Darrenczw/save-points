// Save Points — how long does a sign-in from a FRESH NPSSO token last?
//   NPSSO=... deno run --allow-net --allow-env --allow-read=. --allow-write=. fresh-check.ts
// Saves the new sign-in to spike/.psn-refresh (replacing the old one). The NPSSO itself is not saved.
import { exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens } from "npm:psn-api@2.18.1";

const npsso = Deno.env.get("NPSSO")?.trim();
if (!npsso) { console.error("No NPSSO token given."); Deno.exit(1); }
const a = await exchangeAccessCodeForAuthTokens(await exchangeNpssoForAccessCode(npsso));
await Deno.writeTextFile(".psn-refresh", a.refreshToken, { mode: 0o600 });
const days = a.refreshTokenExpiresIn / 86400;
const until = new Date(Date.now() + a.refreshTokenExpiresIn * 1000).toDateString();
console.log(`✓ Fresh sign-in lasts ${days.toFixed(1)} days (until ${until}).`);
console.log(days > 45 ? "  → Long sign-in confirmed: no need to store the Sony token." : "  → Still short. Tell Claude; we'll look at other options.");
