// Shared plumbing for Save Points edge functions: CORS, admin client, caller identity, PSN sign-in.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  exchangeAccessCodeForAuthTokens, exchangeNpssoForAccessCode, exchangeRefreshTokenForAuthTokens,
} from "npm:psn-api@2.18.1";

const ORIGINS = ["https://darrenczw.github.io", "http://localhost:8766", "http://127.0.0.1:8766"];

export function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-sp-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

export const admin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function config(name: string): Promise<string | null> {
  const { data } = await admin.rpc("sp_get_config", { p_name: name });
  return (data as string) ?? null;
}

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Who is calling? Either the signed-in app (user JWT), or a trusted helper that knows a key.
 * The server keeps only each key's SHA-256 fingerprint (in Vault), never the key itself.
 *   x-sp-key = connect key  (Mac mini keeper, iPhone Shortcut)  → owner
 *   x-sp-key = cron key     (daily GitHub Action)                → owner
 */
export async function caller(req: Request, allow: ("user" | "connect" | "cron")[]): Promise<string | null> {
  const key = req.headers.get("x-sp-key");
  if (key) {
    const got = await sha256hex(key);
    for (const kind of ["connect", "cron"] as const) {
      if (!allow.includes(kind)) continue;
      const want = await config(`${kind}_key_sha256`);
      if (want && timingSafeEqual(got, want)) return await config("owner_id");
    }
    return null;
  }
  if (!allow.includes("user")) return null;
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  return data.user?.id ?? null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export type PsnAuth = Awaited<ReturnType<typeof exchangeRefreshTokenForAuthTokens>>;

async function store(userId: string, a: PsnAuth) {
  await admin.rpc("sp_set_secret", { p_user: userId, p_kind: "refresh", p_value: a.refreshToken });
  await admin.from("psn_link").update({ refresh_expires_at: new Date(Date.now() + a.refreshTokenExpiresIn * 1000).toISOString() })
    .eq("user_id", userId);
}

/** Exchange a fresh NPSSO, keep it (encrypted) for automatic renewals, return the sign-in. */
export async function connectWithNpsso(userId: string, npsso: string): Promise<PsnAuth> {
  const a = await exchangeAccessCodeForAuthTokens(await exchangeNpssoForAccessCode(npsso));
  await admin.rpc("sp_set_secret", { p_user: userId, p_kind: "npsso", p_value: npsso });
  await store(userId, a);
  return a;
}

/** Sign in for a sync: refresh token first; renew from the stored NPSSO when it is missing or ends within 2 days. */
export async function psnSignIn(userId: string): Promise<PsnAuth | null> {
  const [{ data: refresh }, { data: link }] = await Promise.all([
    admin.rpc("sp_get_secret", { p_user: userId, p_kind: "refresh" }),
    admin.from("psn_link").select("refresh_expires_at").eq("user_id", userId).maybeSingle(),
  ]);
  const endsSoon = !link?.refresh_expires_at || Date.parse(link.refresh_expires_at) - Date.now() < 2 * 86400e3;
  if (refresh && !endsSoon) {
    try { const a = await exchangeRefreshTokenForAuthTokens(refresh as string); await store(userId, a); return a; } catch { /* fall through */ }
  }
  const { data: npsso } = await admin.rpc("sp_get_secret", { p_user: userId, p_kind: "npsso" });
  if (npsso) {
    try { const a = await exchangeAccessCodeForAuthTokens(await exchangeNpssoForAccessCode(npsso as string)); await store(userId, a); return a; } catch { /* expired */ }
  }
  if (refresh) {
    try { const a = await exchangeRefreshTokenForAuthTokens(refresh as string); await store(userId, a); return a; } catch { /* expired */ }
  }
  return null;
}
