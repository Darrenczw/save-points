// Save Points — data layer: sign-in, library, ratings (with offline queue), sync.
// With no Supabase config (or ?demo), the app runs on data/timeline.json like the prototype.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const CACHE = "sp.cache.v1", QUEUE = "sp.queue.v1";
const params = new URLSearchParams(location.search);
export const demo = params.has("demo") || !SUPABASE_URL || !window.supabase;
const sb = demo ? null : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } };

// ---------------------------------------------------------------- sign-in (email link; pasting it works inside the Home Screen app)
export async function currentUser() {
  if (demo) return { email: "demo" };
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({
    email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
  });
  if (!error) return;
  if (error.status === 429 || /rate limit/i.test(error.message))
    throw new Error("Too many sign-in emails for now. The free plan sends 2 an hour, so try again in a little while.");
  throw new Error(/signups not allowed|not found/i.test(error.message)
    ? "That email doesn't have a Save Points account." : "Couldn't send the email. Try again in a minute.");
}
/** Accepts the sign-in link from the email (pasted), or a 6-digit code if the email ever includes one. */
export async function verifyCode(email, text) {
  const t = text.trim();
  let error;
  if (/^\d{6}$/.test(t)) ({ error } = await sb.auth.verifyOtp({ email, token: t, type: "email" }));
  else {
    let hash = null;
    try { const u = new URL(t); hash = u.searchParams.get("token") ?? u.searchParams.get("token_hash"); } catch { /* not a link */ }
    if (!hash) throw new Error("Paste the whole link from the email (long-press it, then Copy Link).");
    ({ error } = await sb.auth.verifyOtp({ token_hash: hash, type: "email" }));
  }
  if (error) throw new Error("That link didn't work. Use the newest email, or send a new link.");
}
export async function signOut() { if (sb) await sb.auth.signOut(); localStorage.removeItem(CACHE); localStorage.removeItem(QUEUE); }

// ---------------------------------------------------------------- library
/** Last library we saw, for an instant (and offline) first paint. */
export const cached = () => load(CACHE, null);

/** { games: [...with game_years], ratings: {id: {o,s,g,m,a}}, link } */
export async function fetchLibrary() {
  if (demo) return demoLibrary();
  const [g, r, l] = await Promise.all([
    sb.from("games").select("id, name, platforms, cover_url, hero_url, first_played, last_played, total_hours, hidden, tried_override, source, game_years(year, label, is_main, est_hours)"),
    sb.from("ratings").select("game_id, overall, story, gameplay, music, atmosphere"),
    sb.from("psn_link").select("refresh_expires_at, connected_at, last_sync_at, last_sync_status, last_sync_error").maybeSingle(),
  ]);
  if (g.error) throw g.error;
  const ratings = {};
  for (const x of r.data ?? []) ratings[x.game_id] = clean({ o: num(x.overall), s: x.story, g: x.gameplay, m: x.music, a: x.atmosphere });
  for (const [id, q] of Object.entries(load(QUEUE, {}))) ratings[id] = q; // unsent changes win
  const lib = { games: g.data, ratings, link: l.data ?? null, at: Date.now() };
  save(CACHE, lib);
  return lib;
}
const num = (v) => (v == null ? undefined : Number(v));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== 0));

async function demoLibrary() {
  const T = await (await fetch("data/timeline.json")).json();
  const by = new Map();
  for (const Y of T) for (const g of Y.games) {
    const e = by.get(g.id) ?? {
      id: g.id, name: g.name, platforms: g.plat.split("/"), cover_url: g.cover, hero_url: g.hero,
      first_played: g.first, last_played: g.last, total_hours: g.h, hidden: false, tried_override: null, source: "psn", game_years: [],
    };
    e.game_years.push({ year: Y.year, label: g.label, is_main: g.star, est_hours: g.yh });
    by.set(g.id, e);
  }
  return { games: [...by.values()], ratings: load("sp.ratings", {}), link: { last_sync_at: "2026-11-18T03:32:00Z", last_sync_status: "ok" }, at: Date.now() };
}

/** Turn the library into the timeline the UI draws: years newest first, each with its games. */
export function timeline(lib, today = new Date()) {
  const years = new Map();
  const nowCut = today.getTime() - 14 * 86400e3, thisYear = today.getFullYear();
  for (const g of lib.games) {
    if (g.hidden) continue;
    const mainYear = g.game_years.find((y) => y.is_main)?.year ?? +g.first_played.slice(0, 4);
    const h = Number(g.total_hours);
    for (const y of g.game_years) {
      const Y = years.get(y.year) ?? years.set(y.year, { year: y.year, games: [] }).get(y.year);
      Y.games.push({
        id: g.id, name: g.name, h, yh: Number(y.est_hours), label: y.label, star: y.is_main,
        tried: g.tried_override ?? h < 1, main: mainYear, first: g.first_played, last: g.last_played,
        plat: g.platforms.join("/"), now: y.year === thisYear && Date.parse(g.last_played) >= nowCut,
        cover: g.cover_url, hero: g.hero_url,
      });
    }
  }
  return [...years.values()].sort((a, b) => b.year - a.year).map((Y) => {
    Y.games.sort((a, b) => a.tried - b.tried || b.star - a.star || b.h - a.h);
    Y.count = Y.games.filter((g) => !g.tried).length;
    Y.tried = Y.games.length - Y.count;
    Y.hours = Math.round(Y.games.reduce((n, g) => n + g.yh, 0));
    return Y;
  });
}

// ---------------------------------------------------------------- ratings
let flushing = null;
export function saveRating(id, r) {
  if (demo) { const all = load("sp.ratings", {}); all[id] = r; save("sp.ratings", all); return; }
  const q = load(QUEUE, {}); q[id] = r; save(QUEUE, q);
  const lib = cached(); if (lib) { lib.ratings[id] = r; save(CACHE, lib); }
  flush();
}
export function flush() {
  if (demo || flushing || !navigator.onLine) return flushing;
  flushing = (async () => {
    const q = load(QUEUE, {});
    for (const [id, r] of Object.entries(q)) {
      const row = { game_id: id, overall: r.o ?? null, story: r.s ?? null, gameplay: r.g ?? null, music: r.m ?? null, atmosphere: r.a ?? null };
      const empty = Object.values(row).slice(1).every((v) => v == null);
      const { error } = empty ? await sb.from("ratings").delete().eq("game_id", id) : await sb.from("ratings").upsert(row);
      if (error) break; // try again later
      const now = load(QUEUE, {}); if (JSON.stringify(now[id]) === JSON.stringify(r)) { delete now[id]; save(QUEUE, now); }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
addEventListener("online", () => flush());

// ---------------------------------------------------------------- PSN sync + connection
async function call(fn, body) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(body ?? {}),
  });
  return res.json().catch(() => ({ status: "failed" }));
}
/** Runs psn-sync until it finishes (a first import can need two calls). */
export async function syncNow() {
  if (demo) { await new Promise((r) => setTimeout(r, 1200)); return { status: "ok", deltas: [] }; }
  let out;
  for (let i = 0; i < 3; i++) { out = await call("psn-sync"); if (out.status !== "partial") break; }
  return out;
}
export const connectPsn = (npsso) => call("psn-connect", { npsso });
export const disconnectPsn = () => call("psn-connect", { disconnect: 1 });
