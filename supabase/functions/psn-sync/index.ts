// psn-sync: import / update games, hours, trophies and year labels from PSN.
//   POST {}  → { status: "ok" | "partial" | "expired", games, added, deltas: [{ name, delta }], trophySets }
// "partial" means it stopped early to stay inside the time limit; call again to finish.
// Callers: the app (user JWT) or the daily GitHub Action (x-sp-key = cron key).
import {
  getUserPlayedGames, getUserTitles, getUserTrophiesEarnedForTitle, getUserTrophiesForSpecificTitle,
} from "npm:psn-api@2.18.1";
import { admin, caller, cors, json, psnSignIn } from "../_shared/common.ts";
import { labelYears, mergePlayed, splitHours, type PlayedTitle } from "../_shared/years.ts";

const DEADLINE_MS = 100_000; // stop fetching trophies after this, well inside the 150 s limit

async function inPool<T>(items: T[], size: number, fn: (t: T) => Promise<void>, stop: () => boolean) {
  for (let i = 0; i < items.length; i += size) {
    if (stop()) return false;
    await Promise.all(items.slice(i, i + size).map(fn));
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
  const userId = await caller(req, ["user", "cron"]);
  if (!userId) return json(req, { error: "Not allowed" }, 401);

  const started = Date.now();
  const late = () => Date.now() - started > DEADLINE_MS;
  const link = admin.from("psn_link");
  await link.upsert({ user_id: userId, last_sync_status: "running" }, { onConflict: "user_id" });

  const auth = await psnSignIn(userId);
  if (!auth) {
    await link.update({ last_sync_status: "expired", last_sync_error: "PlayStation sign-in has ended" }).eq("user_id", userId);
    return json(req, { status: "expired" });
  }

  try {
    // 1. Played games → merged games
    const played: PlayedTitle[] = [];
    for (let off = 0; ;) {
      const p = await getUserPlayedGames(auth, "me", { limit: 200, offset: off });
      played.push(...(p.titles as unknown as PlayedTitle[]));
      if (!p.nextOffset || p.nextOffset <= off) break;
      off = p.nextOffset;
    }
    const merged = mergePlayed(played);

    // 2. What we already have
    const { data: existing, error: e1 } = await admin.from("games")
      .select("id, psn_concept_id, total_hours, first_played, last_played, np_sets, trophy_synced_at")
      .eq("user_id", userId).eq("source", "psn");
    if (e1) throw e1;
    const ex = new Map((existing ?? []).map((g) => [g.psn_concept_id as string, g]));

    const baseRow = (g: (typeof merged)[number]) => ({
      user_id: userId, psn_concept_id: g.conceptId, name: g.name, platforms: g.platforms, cover_url: g.cover,
      hero_url: g.hero, first_played: g.first, last_played: g.last, total_hours: g.hours, play_count: g.playCount,
      psn_title_ids: g.titleIds, source: "psn",
    });

    // 3. Upsert games (never touches hidden / tried_override / ratings)
    const { data: up, error: e2 } = await admin.from("games")
      .upsert(merged.map(baseRow), { onConflict: "user_id,psn_concept_id" }).select("id, psn_concept_id");
    if (e2) throw e2;
    const idOf = new Map(up!.map((r) => [r.psn_concept_id as string, r.id as string]));

    // 4. Hour snapshots and deltas
    const changed = new Set<string>(), snaps: Record<string, unknown>[] = [], deltas: { name: string; delta: number }[] = [];
    let added = 0;
    for (const g of merged) {
      const p = ex.get(g.conceptId);
      const prevH = p ? Number(p.total_hours) : null;
      if (!p) added++;
      if (!p || prevH !== g.hours || p.first_played !== g.first || p.last_played !== g.last) changed.add(g.conceptId);
      if (prevH === null || Math.abs(prevH - g.hours) >= 0.01) snaps.push({ game_id: idOf.get(g.conceptId), user_id: userId, total_hours: g.hours });
      if (prevH !== null && g.hours - prevH >= 0.05) deltas.push({ name: g.name, delta: Math.round((g.hours - prevH) * 10) / 10 });
    }
    if (snaps.length) { const { error } = await admin.from("hour_snapshots").insert(snaps); if (error) throw error; }

    // 5. Trophies: map new games to trophy sets, refetch sets that changed
    const titles: { npCommunicationId: string; lastUpdatedDateTime: string }[] = [];
    for (let off = 0; ;) {
      const p = await getUserTitles(auth, "me", { limit: 800, offset: off });
      titles.push(...p.trophyTitles);
      if (!p.nextOffset || p.nextOffset <= off) break;
      off = p.nextOffset;
    }
    const setUpdated = new Map(titles.map((t) => [t.npCommunicationId, t.lastUpdatedDateTime]));

    // A game can have several trophy lists (PS4 original + PS5 remaster): keep them all.
    type TSet = { id: string; svc: "trophy" | "trophy2" };
    const np = new Map<string, TSet[]>();
    for (const [c, p] of ex) if ((p.np_sets as TSet[])?.length) np.set(c, p.np_sets as TSet[]);
    const unmapped = merged.filter((g) => !ex.get(g.conceptId)?.trophy_synced_at);
    const conceptOfTitle = new Map(unmapped.flatMap((g) => g.titleIds.map((t) => [t, g.conceptId] as const)));
    const ids = [...conceptOfTitle.keys()];
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 5) batches.push(ids.slice(i, i + 5));
    await inPool(batches, 4, async (b) => {
      try {
        const r = await getUserTrophiesForSpecificTitle(auth, "me", { npTitleIds: b.join(",") });
        for (const t of r.titles) {
          const tt = t.trophyTitles?.[0], c = conceptOfTitle.get(t.npTitleId);
          if (!tt || !c) continue;
          const list = np.get(c) ?? [];
          if (!list.some((x) => x.id === tt.npCommunicationId)) list.push({ id: tt.npCommunicationId, svc: tt.npServiceName as TSet["svc"] });
          np.set(c, list);
        }
      } catch { /* titles without trophies */ }
    }, late);

    const todo = merged.filter((g) => {
      const p = ex.get(g.conceptId), sets = np.get(g.conceptId) ?? [];
      if (!p?.trophy_synced_at) return true;
      return sets.some((s) => { const upd = setUpdated.get(s.id); return !!upd && Date.parse(upd) > Date.parse(p.trophy_synced_at); });
    });
    const fresh = new Map<string, Record<number, number>>();
    const finished = await inPool(todo, 6, async (g) => {
      const per: Record<number, number> = {};
      for (const set of np.get(g.conceptId) ?? []) {
        try {
          const r = await getUserTrophiesEarnedForTitle(auth, "me", set.id, "all", { npServiceName: set.svc });
          for (const t of r.trophies) if (t.earned && t.earnedDateTime) { const y = +t.earnedDateTime.slice(0, 4); per[y] = (per[y] ?? 0) + 1; }
        } catch { /* skip this list */ }
      }
      fresh.set(g.conceptId, per);
    }, late);

    if (fresh.size) {
      const gids = [...fresh.keys()].map((c) => idOf.get(c)!);
      const { error: d1 } = await admin.from("trophy_years").delete().in("game_id", gids); if (d1) throw d1;
      const rows = [...fresh].flatMap(([c, per]) => Object.entries(per).map(([y, n]) => ({ game_id: idOf.get(c), user_id: userId, year: +y, trophies: n })));
      if (rows.length) { const { error } = await admin.from("trophy_years").insert(rows); if (error) throw error; }
      const now = new Date().toISOString();
      const marked = merged.filter((g) => fresh.has(g.conceptId)).map((g) => ({
        ...baseRow(g), np_sets: np.get(g.conceptId) ?? [], trophy_synced_at: now,
      }));
      const { error } = await admin.from("games").upsert(marked, { onConflict: "user_id,psn_concept_id" }); if (error) throw error;
      for (const c of fresh.keys()) changed.add(c);
    }

    // 6. Recompute year labels for every game that changed (manual choices always win)
    const redo = merged.filter((g) => changed.has(g.conceptId));
    if (redo.length) {
      const gids = redo.map((g) => idOf.get(g.conceptId)!);
      const [{ data: ty }, { data: manual }] = await Promise.all([
        admin.from("trophy_years").select("game_id, year, trophies").in("game_id", gids),
        admin.from("game_years").select("game_id, year, is_main").in("game_id", gids).eq("label_source", "manual"),
      ]);
      const per = new Map<string, Record<number, number>>();
      for (const r of ty ?? []) (per.get(r.game_id) ?? per.set(r.game_id, {}).get(r.game_id)!)[r.year] = r.trophies;
      const manualYears = new Set((manual ?? []).map((r) => `${r.game_id}|${r.year}`));
      const manualMain = new Set((manual ?? []).filter((r) => r.is_main).map((r) => r.game_id));
      const today = new Date().toISOString().slice(0, 10);
      const rows: Record<string, unknown>[] = [];
      const keepHours: { gid: string; year: number; h: number | undefined }[] = [];
      for (const g of redo) {
        const gid = idOf.get(g.conceptId)!;
        const entries = labelYears(g.first, g.last, per.get(gid) ?? {}, today);
        const hours = splitHours(g.hours, entries);
        for (const e of entries) {
          if (manualYears.has(`${gid}|${e.year}`)) { keepHours.push({ gid, year: e.year, h: hours.get(e.year) }); continue; } // label is Darren's; hours stay live
          rows.push({ game_id: gid, user_id: userId, year: e.year, label: e.label, is_main: e.isMain && !manualMain.has(gid), est_hours: hours.get(e.year), label_source: "auto" });
        }
      }
      const { error: d2 } = await admin.from("game_years").delete().in("game_id", gids).eq("label_source", "auto"); if (d2) throw d2;
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("game_years").insert(rows.slice(i, i + 500)); if (error) throw error;
      }
      for (const k of keepHours) {
        const { error } = await admin.from("game_years").update({ est_hours: k.h ?? 0 }).eq("game_id", k.gid).eq("year", k.year); if (error) throw error;
      }
    }

    const status = finished ? "ok" : "partial";
    await link.update({ last_sync_at: new Date().toISOString(), last_sync_status: finished ? "ok" : "running", last_sync_error: null }).eq("user_id", userId);
    return json(req, { status, games: merged.length, added, deltas, trophySets: fresh.size, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await link.update({ last_sync_status: "failed", last_sync_error: msg.slice(0, 300) }).eq("user_id", userId);
    return json(req, { status: "failed", error: "Sync failed. Try again in a minute." }, 500);
  }
});
