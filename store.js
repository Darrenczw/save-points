// Save Points — data layer: sign-in, library, ratings (with offline queue), sync.
// With no Supabase config (or ?demo), the app runs on data/timeline.json like the prototype.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const CACHE = "sp.cache.v1", QUEUE = "sp.queue.v1", EDITS = "sp.edits.v1";
const params = new URLSearchParams(location.search);
export const demo = params.has("demo") || !SUPABASE_URL || !window.supabase;
const sb = demo ? null : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } };

// ---------------------------------------------------------------- sign-in: 6-digit pairing code from a signed-in device, or an email link
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
/** On a signed-in device: make a 6-digit code another device can use to sign in (5 minutes, once). */
export async function createPairCode() {
  const out = await call("pair", { action: "create" });
  if (!out.code) throw new Error(out.error ?? "Couldn't make a code. Try again.");
  return out;
}
/** On a new device: sign in with the code shown on a signed-in device. */
export async function redeemPairCode(code) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pair`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ action: "redeem", code }),
  });
  const out = await res.json().catch(() => ({}));
  if (!out.tokenHash) throw new Error(out.error ?? "That code didn't work.");
  let { error } = await sb.auth.verifyOtp({ token_hash: out.tokenHash, type: "email" });
  if (error) ({ error } = await sb.auth.verifyOtp({ token_hash: out.tokenHash, type: "magiclink" }));
  if (error) throw new Error("That code didn't work. Make a new one and try again.");
}
export async function signOut() { if (sb) await sb.auth.signOut(); localStorage.removeItem(CACHE); localStorage.removeItem(QUEUE); localStorage.removeItem(EDITS); }

// ---------------------------------------------------------------- library
/** Last library we saw, for an instant (and offline) first paint. */
let current = null; // the library on screen (demo mode never touches the cache)
export const cached = () => load(CACHE, null);

/** { games: [...with game_years], ratings: {id: {o,s,g,m,a}}, link } */
export async function fetchLibrary() {
  if (demo) return (current = await demoLibrary());
  const [g, r, l] = await Promise.all([
    sb.from("games").select("id, name, platforms, cover_url, hero_url, first_played, last_played, total_hours, hidden, tried_override, source, game_years(year, label, is_main, est_hours, removed)"),
    sb.from("ratings").select("game_id, overall, story, gameplay, music, atmosphere"),
    sb.from("psn_link").select("refresh_expires_at, connected_at, last_sync_at, last_sync_status, last_sync_error").maybeSingle(),
  ]);
  if (g.error) throw g.error;
  const ratings = {};
  for (const x of r.data ?? []) ratings[x.game_id] = clean({ o: num(x.overall), s: x.story, g: x.gameplay, m: x.music, a: x.atmosphere });
  for (const [id, q] of Object.entries(load(QUEUE, {}))) ratings[id] = q; // unsent changes win
  const lib = { games: g.data, ratings, link: l.data ?? null, at: Date.now() };
  for (const op of load(EDITS, [])) applyEdit(lib, op);                    // so do unsent edits
  save(CACHE, lib);
  return (current = lib);
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
  const lib = { games: [...by.values()], ratings: load("sp.ratings", {}), link: { last_sync_at: "2026-11-18T03:32:00Z", last_sync_status: "ok" }, at: Date.now() };
  for (const op of load("sp.demo.edits", [])) applyEdit(lib, op);
  return lib;
}

/** Turn the library into the timeline the UI draws: years newest first, each with its games. */
export function timeline(lib, today = new Date()) {
  const years = new Map();
  const nowCut = today.getTime() - 14 * 86400e3, thisYear = today.getFullYear();
  for (const g of lib.games) {
    if (g.hidden) continue;
    const yrs = g.game_years.filter((y) => !y.removed);
    if (!yrs.length) continue;
    const mainYear = yrs.find((y) => y.is_main)?.year ?? [...yrs].sort((a, b) => b.est_hours - a.est_hours)[0].year;
    const h = Number(g.total_hours);
    for (const y of yrs) {
      const Y = years.get(y.year) ?? years.set(y.year, { year: y.year, games: [] }).get(y.year);
      Y.games.push({
        id: g.id, name: g.name, h, yh: Number(y.est_hours), label: y.label, star: y.year === mainYear,
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
  flushEdits();
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
addEventListener("online", () => { flush(); flushEdits(); });

// ---------------------------------------------------------------- edits: year labels, ★, remove from a year, hide, Tried
// op = { k: "year", id, year, label?, main?, removed? } | { k: "game", id, hidden?, tried? }   (tried: true | false)
function applyEdit(lib, op) {
  const g = lib.games.find((x) => x.id === op.id); if (!g) return;
  if (op.k === "game") {
    if ("hidden" in op) g.hidden = op.hidden;
    if ("tried" in op) g.tried_override = op.tried;
    return;
  }
  const y = g.game_years.find((x) => x.year === op.year); if (!y) return;
  if (op.label) y.label = op.label;
  if ("removed" in op) y.removed = op.removed;
  if (op.main) for (const x of g.game_years) x.is_main = x === y;
  y.label_source = "manual";
}
/** The raw game record (includes hidden games and removed years). */
export const rawGame = (id) => (current ?? cached())?.games.find((g) => g.id === id) ?? null;
export const hiddenGames = () => ((current ?? cached())?.games ?? []).filter((g) => g.hidden).sort((a, b) => a.name.localeCompare(b.name));
/** Apply an edit now (screen + cache), queue it for the server. Returns the updated library. */
export function edit(op) {
  const lib = current ?? cached(); if (!lib) return null;
  applyEdit(lib, op);
  if (demo) { const q = load("sp.demo.edits", []); q.push(op); save("sp.demo.edits", q); return lib; }
  save(CACHE, lib);
  const q = load(EDITS, []); q.push(op); save(EDITS, q);
  flushEdits();
  return lib;
}
let sendingEdits = null;
function flushEdits() {
  if (demo || sendingEdits || !navigator.onLine) return sendingEdits;
  sendingEdits = (async () => {
    for (;;) {
      const [op] = load(EDITS, []); if (!op) break;
      if (!(await sendEdit(op))) break;                              // try again later
      const q = load(EDITS, []); if (JSON.stringify(q[0]) === JSON.stringify(op)) { q.shift(); save(EDITS, q); }
    }
  })().finally(() => { sendingEdits = null; });
  return sendingEdits;
}
async function sendEdit(op) {
  if (op.k === "game") {
    const patch = {};
    if ("hidden" in op) patch.hidden = op.hidden;
    if ("tried" in op) patch.tried_override = op.tried;
    return !(await sb.from("games").update(patch).eq("id", op.id)).error;
  }
  if (op.main) { const { error } = await sb.from("game_years").update({ is_main: false }).eq("game_id", op.id).neq("year", op.year); if (error) return false; }
  const patch = { label_source: "manual" };
  if (op.label) patch.label = op.label;
  if ("removed" in op) patch.removed = op.removed;
  if (op.main) patch.is_main = true;
  return !(await sb.from("game_years").update(patch).eq("game_id", op.id).eq("year", op.year)).error;
}

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
