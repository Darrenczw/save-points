// Does refreshing restart the refresh token's lifetime (rolling), or count down to a fixed end?
import { exchangeRefreshTokenForAuthTokens } from "npm:psn-api@2.18.1";
const go = async () => {
  const a = await exchangeRefreshTokenForAuthTokens((await Deno.readTextFile(".psn-refresh")).trim());
  await Deno.writeTextFile(".psn-refresh", a.refreshToken, { mode: 0o600 });
  return a.refreshTokenExpiresIn;
};
const a = await go(); await new Promise((r) => setTimeout(r, 20000)); const b = await go();
console.log(`first ${a}s, 20 s later ${b}s → ${Math.abs(a - b) < 5 ? "ROLLING (lifetime restarts each refresh)" : b < a ? "FIXED end date (counts down)" : "unclear"}`);
