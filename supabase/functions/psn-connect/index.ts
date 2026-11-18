// psn-connect: store a fresh Sony sign-in, or disconnect.
//   POST { npsso }          → { connected: true, expiresAt }
//   POST { disconnect: 1 }  → { connected: false }
// Callers: the app (user JWT), the Mac mini keeper or the iPhone Shortcut (x-sp-key = connect key).
// The NPSSO is never logged and never returned.
import { admin, caller, connectWithNpsso, cors, json } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);

  const userId = await caller(req, ["user", "connect"]);
  if (!userId) return json(req, { error: "Not allowed" }, 401);

  let body: { npsso?: string; disconnect?: unknown };
  try { body = await req.json(); } catch { return json(req, { error: "Send JSON" }, 400); }

  if (body.disconnect) {
    await admin.rpc("sp_forget_psn", { p_user: userId });
    return json(req, { connected: false });
  }

  // Accept the raw token or the whole {"npsso":"…"} text the Sony page shows.
  let npsso = String(body.npsso ?? "").trim();
  const m = npsso.match(/"npsso"\s*:\s*"([^"]+)"/);
  if (m) npsso = m[1];
  if (!/^[A-Za-z0-9]{40,128}$/.test(npsso)) {
    return json(req, { error: "That doesn't look like a PlayStation token. Copy the long code from the token page." }, 400);
  }

  try {
    const a = await connectWithNpsso(userId, npsso);
    await admin.from("psn_link").update({ last_sync_status: null, last_sync_error: null }).eq("user_id", userId);
    return json(req, { connected: true, expiresAt: new Date(Date.now() + a.refreshTokenExpiresIn * 1000).toISOString() });
  } catch {
    return json(req, { error: "PlayStation didn't accept that token. Sign in on playstation.com again and copy a new one." }, 400);
  }
});
