// pair: sign in a new device with a 6-digit code shown on a device that's already signed in.
//   POST { action: "create" }        (signed-in app)  → { code, expiresAt }
//   POST { action: "redeem", code }  (no sign-in)     → { tokenHash }   then the app calls verifyOtp({ token_hash })
// Codes are single-use, last 5 minutes, and only their SHA-256 is stored. No email is sent.
import { admin, caller, cors, json } from "../_shared/common.ts";

const LIFETIME_MS = 5 * 60 * 1000;
const MAX_FAILS = 10; // failed redeems allowed per 10 minutes, across everyone

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sixDigits(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
  let body: { action?: string; code?: string };
  try { body = await req.json(); } catch { return json(req, { error: "Send JSON" }, 400); }

  if (body.action === "create") {
    const userId = await caller(req, ["user"]);
    if (!userId) return json(req, { error: "Sign in first" }, 401);
    const { data: u } = await admin.auth.admin.getUserById(userId);
    if (!u.user?.email) return json(req, { error: "No email on this account" }, 400);
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    if (error || !link.properties?.hashed_token) return json(req, { error: "Couldn't make a code. Try again." }, 500);

    await admin.from("device_codes").delete().eq("user_id", userId); // one live code at a time
    let code = "";
    for (let i = 0; i < 5; i++) {
      code = sixDigits();
      const { error: e } = await admin.from("device_codes").insert({
        code_hash: await sha256hex(code), user_id: userId, token_hash: link.properties.hashed_token,
        expires_at: new Date(Date.now() + LIFETIME_MS).toISOString(),
      });
      if (!e) return json(req, { code, expiresAt: new Date(Date.now() + LIFETIME_MS).toISOString() });
    }
    return json(req, { error: "Couldn't make a code. Try again." }, 500);
  }

  if (body.action === "redeem") {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from("pair_attempts").select("id", { count: "exact", head: true }).gte("created_at", since);
    if ((count ?? 0) >= MAX_FAILS) return json(req, { error: "Too many wrong codes. Wait 10 minutes, then make a new code." }, 429);

    const code = String(body.code ?? "").replace(/\D/g, "");
    const { data: row } = code.length === 6
      ? await admin.from("device_codes").select("code_hash, token_hash, expires_at, used_at").eq("code_hash", await sha256hex(code)).maybeSingle()
      : { data: null };
    if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) {
      await admin.from("pair_attempts").insert({});
      return json(req, { error: "That code didn't work. Check it, or make a new one (codes last 5 minutes)." }, 400);
    }
    const { data: claimed } = await admin.from("device_codes").update({ used_at: new Date().toISOString() })
      .eq("code_hash", row.code_hash).is("used_at", null).select("code_hash");
    if (!claimed?.length) return json(req, { error: "That code was just used. Make a new one." }, 400);
    return json(req, { tokenHash: row.token_hash });
  }

  return json(req, { error: "Unknown action" }, 400);
});
