// Save Points — The Line. App shell: timeline, ratings, sync, sign-in. Data lives in store.js.
import * as store from "./store.js";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const params = new URLSearchParams(location.search);
const DEMO_STATE = params.get("state"); // importing | syncing | syncfail | expired | offline

const STAR = "M12 2.6l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z";
const ICON = {
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}" fill="currentColor"/><path class="h" d="${STAR}" fill="transparent" clip-path="url(#half)"/></svg>`,
};
const CATS = [["s", "Story"], ["g", "Gameplay"], ["m", "Music"], ["a", "Atmosphere"]];

let T = [];               // years, newest first
const byId = new Map();   // id -> { game (any entry), years: [{year,label,star}] }
let ratings = {};
let link = null;          // PSN connection status from the server
let lastExtra = "";       // e.g. "NBA 2K26 +1.2 h" after a sync
let user = null;

const yc = (y) => (y >= 2018 && y <= 2026 ? `var(--y${y})` : "var(--y-other)");
const hrs1 = (h) => `${(Math.round(h * 10) / 10).toString()} h`; // exact hours on the Now playing card
const hrs = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)} h`);
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

function art(g, w, cls = "") {
  if (!g.cover) return `<div class="ph ${cls}" style="--c:${yc(g.main)}" aria-hidden="true">${esc(g.name)}</div>`;
  return `<img class="${cls}" src="${g.cover}?w=${w}" alt="" loading="lazy" decoding="async" width="${w}" height="${w}">`;
}

// ---------------------------------------------------------------- render
function station(Y, i) {
  const y = Y.year, c = yc(y);
  const main = Y.games.filter((g) => g.star && !g.tried);
  const rets = Y.games.filter((g) => !g.star && !g.tried).sort((a, b) => b.yh - a.yh);
  const tried = Y.games.filter((g) => g.tried);
  const now = y === T[0].year ? Y.games.filter((g) => g.now).sort((a, b) => b.last.localeCompare(a.last)) : [];
  const nowIds = new Set(now.map((g) => g.id));
  const grid = main.filter((g) => !nowIds.has(g.id));
  const shownRets = rets.filter((g) => !nowIds.has(g.id));

  let h = `<section class="stn" id="y${y}" style="--c:${c}" data-year="${y}" aria-labelledby="h${y}">
    <button class="spine" data-map aria-label="Open line map"></button>
    <div class="head"><span class="dot"></span><h2 class="year" id="h${y}">${y}</h2></div>
    <p class="meta num">${Y.count} games · ${Y.hours.toLocaleString()} hours</p>`;

  if (i === 0) {
    h += `<button class="ann" id="ann" aria-live="polite"></button>`;
    if (now.length) {
      const g = now[0];
      h += `<article class="now">
        <img class="art" src="${g.hero || g.cover}?w=900" alt="" fetchpriority="high">
        <span class="np">Now playing</span>
        <div class="cap"><button class="cap-t" data-open="${g.id}"><span class="t">${esc(g.name)}</span>
          <span class="p num"><span id="now-h">${hrs1(g.h)}</span> · since ${g.main}</span></button>
          ${rateBtn(g)}</div></article>`;
      for (const g2 of now.slice(1))
        h += `<button class="also" data-open="${g2.id}">${art(g2, 120)}<span>Also playing <b>${esc(g2.name)}</b></span></button>`;
    }
  }

  h += `<div class="grid">${grid.map((g) => cover(g)).join("")}</div>`;

  h += retList("Back from earlier years", shownRets.filter((g) => g.main < y), y);
  h += retList("Before their main year", shownRets.filter((g) => g.main > y), y);

  h += `<div class="foot"><span class="num"><b>${y}</b> · ${Y.count} games · ${Y.hours.toLocaleString()} h</span>
    ${tried.length ? `<button class="tried-btn" aria-expanded="false" aria-controls="t${y}">Tried ${tried.length} ${ICON.chev}</button>` : ""}</div>
    ${tried.length ? `<div class="tried" id="t${y}" hidden>${tried.map((g) => cover(g, true)).join("")}</div>` : ""}
  </section>`;
  return h;
}

function cover(g, small = false) {
  return `<button class="cov" data-open="${g.id}">${art(g, small ? 160 : 260)}<span>${esc(g.name)}</span>${small ? `<small class="num">${hrs(g.h)}</small>` : ""}</button>`;
}
function retList(title, list, y) {
  if (!list.length) return "";
  const first = list.slice(0, 5), rest = list.slice(5);
  return `<h3 class="sub">${title}</h3><div class="xfer">${first.map((g) => ret(g, y)).join("")}
    ${rest.length ? `<div class="xfer-more" hidden>${rest.map((g) => ret(g, y)).join("")}</div><button class="more" data-more>Show ${rest.length} more</button>` : ""}</div>`;
}
function ret(g, y) {
  return `<button class="x" data-open="${g.id}">${art(g, 120)}<span class="n"><span>${esc(g.name)}</span><small class="num">${g.label} · ~${hrs(g.yh)} this year</small></span>
    <span class="pill" style="--pc:${yc(g.main)}">${g.main}</span></button>`;
}
function rateBtn(g) {
  const r = ratings[g.id];
  return r?.o ? `<button class="rated" data-open="${g.id}" aria-label="Rated ${r.o} stars, change">${ICON.star}${r.o}</button>`
    : `<button class="rate" data-rate="${g.id}">Rate</button>`;
}

function renderAnn(state, extra) {
  const a = $("#ann"); if (!a) return;
  a.className = "ann";
  if (state === "syncing") { a.classList.add("busy"); a.innerHTML = `${ICON.sync}<span>Syncing with PlayStation…</span>`; return; }
  if (state === "syncfail") { a.classList.add("bad"); a.innerHTML = `${ICON.warn}<span>Couldn't reach PlayStation. <b>Try again</b></span>`; return; }
  if (state === "expired") { a.classList.add("bad"); a.innerHTML = `${ICON.warn}<span>PlayStation sign-in expired. <b>Reconnect</b></span>`; return; }
  const last = link?.last_sync_at ? Date.parse(link.last_sync_at) : null;
  if (state === "offline") { a.innerHTML = `${ICON.sync}<span>Offline · showing what you had${last ? " " + ago(last) : ""}</span>`; return; }
  a.innerHTML = `${ICON.sync}<span>${last ? `Synced ${ago(last)}` : "Not synced yet · tap to sync"}${extra ? ` · <b>${esc(extra)}</b>` : ""}</span>`;
}

function annState() {
  if (DEMO_STATE && DEMO_STATE !== "importing") return DEMO_STATE;
  if (!navigator.onLine) return "offline";
  return link?.last_sync_status === "expired" ? "expired" : link?.last_sync_status === "failed" ? "syncfail" : "idle";
}
function render() {
  if (!T.length) return emptyState();
  if (location.hash === "#stats") showView();
  $("#line").innerHTML = T.map(station).join("");
  renderAnn(annState(), lastExtra);
  observe();
}

// ---------------------------------------------------------------- arrival: mark the station you're in
function observe() {
  const stns = [...document.querySelectorAll(".stn")];
  let ticking = false;
  const mark = () => {
    ticking = false;
    const line = innerHeight * 0.25;
    let cur = stns[0];
    for (const s of stns) { if (s.getBoundingClientRect().top <= line) cur = s; else break; }
    if (!cur.classList.contains("here")) { stns.forEach((s) => s.classList.remove("here", "stuck")); cur.classList.add("here"); }
    const pad = parseFloat(getComputedStyle(cur).paddingTop) || 0; // stuck = the head has slid down inside its section
    cur.classList.toggle("stuck", cur.querySelector(".head").getBoundingClientRect().top - cur.getBoundingClientRect().top > pad + 1);
  };
  observe.handler && removeEventListener("scroll", observe.handler);
  observe.handler = () => { if (!ticking) { ticking = true; requestAnimationFrame(mark); } };
  addEventListener("scroll", observe.handler, { passive: true });
  mark();
}

// ---------------------------------------------------------------- game sheet + ratings
function openGame(id, focusRate = false) {
  const e = byId.get(id); if (!e) return;
  const g = e.game, r = ratings[id] || {};
  const d = $("#game");
  d.style.setProperty("--c", yc(g.main));
  d.innerHTML = `<div class="grab" aria-hidden="true"></div>
    <div class="g-head">${art(g, 200)}<div><h2 id="g-name">${esc(g.name)}</h2>
      <p class="num">${hrs1(g.h)} · ${g.plat} · ${fmtDate(g.first)} – ${fmtDate(g.last)}</p></div></div>
    <div class="g-years">${e.years.map((x) => `<span class="l"><span class="pill" style="--pc:${yc(x.year)}">${x.year}</span>${x.label}${x.star ? `<span class="mk" role="img" aria-label="main year" style="--pc:${yc(x.year)}">${ICON.star}</span>` : ""}</span>`).join("")}</div>
    <div class="rates">
      ${starRow("o", "Overall", r.o, true)}
      ${CATS.map(([k, n]) => starRow(k, n, r[k])).join("")}
    </div>
    <p class="hint">Tap the left half of a star for a half star. Tap a category star again to clear it.</p>
    <button class="done" data-close>Done</button>`;
  d.showModal();
  if (focusRate) d.querySelector('[data-k="o"]').focus();
  d.querySelectorAll(".stars").forEach((s) => wireStars(s, id));
}
function fmtDate(s) { const [y, m] = s.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y}`; }
function starRow(k, label, v = 0, main = false) {
  const btns = [1, 2, 3, 4, 5].map((n) => `<button tabindex="-1" data-n="${n}" aria-hidden="true">${ICON.star}</button>`).join("");
  return `<div class="r-row${main ? " main" : ""}"><h3 id="l-${k}">${label}</h3>
    <div class="stars" role="slider" tabindex="0" data-k="${k}" aria-labelledby="l-${k}" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${v || 0}" aria-valuetext="${v ? v + " stars" : "Not rated"}">${btns}</div></div>`;
}
function paint(el, v) {
  el.querySelectorAll("button").forEach((b) => {
    const n = +b.dataset.n;
    b.classList.toggle("on", v >= n);
    b.classList.toggle("half", v < n && v >= n - 0.5);
  });
  el.setAttribute("aria-valuenow", v || 0);
  el.setAttribute("aria-valuetext", v ? `${v} stars` : "Not rated");
}
function wireStars(el, id) {
  const k = el.dataset.k, halfOk = k === "o";
  const set = (v) => {
    v = Math.max(0, Math.min(5, v));
    ratings[id] = { ...(ratings[id] || {}), [k]: v || undefined };
    ratings[id] = Object.fromEntries(Object.entries(ratings[id]).filter(([, x]) => x));
    store.saveRating(id, ratings[id]); paint(el, v);
    if (k === "o") refreshRate(id);
  };
  paint(el, ratings[id]?.[k] || 0);
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    const n = +b.dataset.n, rect = b.getBoundingClientRect();
    let v = halfOk && ev.clientX - rect.left < rect.width / 2 ? n - 0.5 : n;
    if (!halfOk && (ratings[id]?.[k] || 0) === v) v = 0;
    set(v);
  });
  el.addEventListener("keydown", (ev) => {
    const step = halfOk ? 0.5 : 1, cur = ratings[id]?.[k] || 0;
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") { set(cur + step); ev.preventDefault(); }
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") { set(cur - step); ev.preventDefault(); }
  });
}
function refreshRate(id) {
  document.querySelectorAll(`[data-rate="${id}"], .rated[data-open="${id}"]`).forEach((b) => (b.outerHTML = rateBtn(byId.get(id).game)));
}

// ---------------------------------------------------------------- line map
// A station is named after its landmark: the highest-rated main-year game, else the one with the most hours
// that year, skipping yearly sports series so 2020 reads "The Witcher 3", not "NBA 2K21".
const SERIES = /NBA 2K|FIFA|EA SPORTS FC|\bFC \d|PES|PRO EVOLUTION|eFootball|Madden|WWE 2K|UFC|F1/i;
const short = (n) => n.split(/\s+[—–-]\s+/)[0].replace(/[:\s]+(the\s+)?(definitive|complete|ultimate|deluxe|remastered|game of the year|goty)\b.*$/i, ""); // "The Witcher 3: Wild Hunt — Remastered" → "The Witcher 3: Wild Hunt"
function landmark(Y) {
  const main = Y.games.filter((g) => g.star && !g.tried);
  const pool = main.filter((g) => !SERIES.test(g.name));
  const list = pool.length ? pool : main;
  const r = (g) => ratings[g.id]?.o || 0;
  return [...list].sort((a, b) => r(b) - r(a) || b.yh - a.yh)[0];
}
function openMap() {
  const here = $(".stn.here")?.dataset.year;
  const d = $("#map");
  d.innerHTML = `<h2>Line map</h2><ol>${T.map((Y) => `<li style="--c:${yc(Y.year)}"><a href="#y${Y.year}" aria-current="${String(Y.year) === here}">
      <strong>${Y.year}</strong><span class="nm"><b>${esc(short(landmark(Y)?.name || ""))}</b><small class="num">${Y.count} games</small></span></a></li>`).join("")}</ol>`;
  d.showModal();
  d.querySelector('[aria-current="true"]')?.focus();
}

// ---------------------------------------------------------------- sync
let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true; renderAnn("syncing");
  const nowId = $(".now .cap-t")?.dataset.open, before = nowId && byId.get(nowId)?.game.h;
  try {
    const out = await store.syncNow();
    if (out.status === "expired") { link = { ...link, last_sync_status: "expired" }; renderAnn("expired"); return; }
    if (out.status !== "ok") { renderAnn("syncfail"); return; }
    const top = [...(out.deltas ?? [])].sort((a, b) => b.delta - a.delta)[0];
    lastExtra = top ? `${top.name} +${top.delta} h` : out.added ? `${out.added} new games` : "No new hours";
    setLibrary(await store.fetchLibrary());
    render();
    const h = $("#now-h"), after = nowId && byId.get(nowId)?.game.h;
    if (h && before != null && after - before >= 0.05) { // the hero's hours tick up, the "+x h" settles away
      h.insertAdjacentHTML("afterend", `<span class="delta">+${Math.round((after - before) * 10) / 10} h</span>`);
      h.nextElementSibling.addEventListener("animationend", (e) => e.target.remove());
    }
  } catch { renderAnn(navigator.onLine ? "syncfail" : "offline"); }
  finally { syncing = false; }
}

// ---------------------------------------------------------------- sign-in, first import, empty
function screen(html) { $("#line").innerHTML = `<section class="boot">${html}</section>`; }

function signIn() {
  document.body.classList.add("out");
  screen(`<h1>Save Points</h1>
    <p>Type the 6-digit code from Save Points on a device that's already signed in: <b>Settings → Sign in another device</b>.</p>
    <form class="form" id="f-pair"><label for="pc">Code</label>
      <input id="pc" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required>
      <button class="go">Sign in</button><p class="err" role="alert"></p></form>
    <button class="link" id="by-email">No other device signed in? Email me a sign-in link</button>`);
  const f = $("#f-pair");
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const b = f.querySelector(".go"); b.disabled = true; b.textContent = "Signing in…";
    try { await store.redeemPairCode($("#pc").value); start(); }
    catch (e) { f.querySelector(".err").textContent = e.message; b.disabled = false; b.textContent = "Sign in"; }
  };
  $("#by-email").onclick = () => emailStep();
}
function emailStep(email = "") {
  screen(`<h1>Sign in by email</h1><p>We'll email you a sign-in link.</p>
    <form class="form" id="f-email"><label for="em">Email</label>
      <input id="em" type="email" autocomplete="email" inputmode="email" required value="${esc(email)}">
      <button class="go">Send link</button><p class="err" role="alert"></p></form>
    <button class="link" id="back">I have a code</button>`);
  $("#back").onclick = () => signIn();
  const f = $("#f-email");
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const em = $("#em").value.trim(), b = f.querySelector(".go");
    b.disabled = true; b.textContent = "Sending…";
    try {
      await store.sendCode(em);
      screen(`<h1>Check your email</h1><p>Tap <b>Sign in</b> in the email we sent to <b>${esc(em)}</b>. It opens Save Points in your browser, signed in.</p>
        <p>Using the Home Screen app on iPhone? After the link opens in Safari, go to <b>Settings → Sign in another device</b> there, then type that code here.</p>
        <button class="go" id="have-code">I have a code</button>`);
      $("#have-code").onclick = () => signIn();
    } catch (e) { f.querySelector(".err").textContent = e.message; b.disabled = false; b.textContent = "Send link"; }
  };
}
function importing() {
  screen(`<h1>Importing your games</h1><p>From PlayStation. This takes about half a minute the first time.</p>`);
  $(".boot").style.setProperty("--p", "60%");
}
function emptyState() {
  screen(`<h1>No games yet</h1><p>Connect PlayStation in Settings, or tap below to import.</p>
    <button class="go" id="first-sync">Import from PlayStation</button>`);
  $("#first-sync").onclick = async () => { importing(); await store.syncNow(); setLibrary(await store.fetchLibrary()); render(); };
}

// ---------------------------------------------------------------- stats (wallet: one fare card per year)
let openYear = null, statsPushed = false;
function yearStats(Y) {
  const gs = Y.games.filter((g) => !g.tried);
  const top = gs.reduce((b, g) => (g.yh > (b?.yh ?? -1) ? g : b), null);
  const sports = Math.round(gs.filter((g) => SERIES.test(g.name)).reduce((n, g) => n + g.yh, 0));
  const fresh = gs.filter((g) => +g.first.slice(0, 4) === Y.year).sort((a, b) => a.first.localeCompare(b.first));
  return {
    year: Y.year, hours: Y.hours, games: Y.count, top, sports, story: Math.max(0, Y.hours - sports),
    first: fresh[0], last: fresh.length > 1 ? fresh[fresh.length - 1] : null,
    back: gs.filter((g) => !g.star).length, replays: gs.filter((g) => g.label === "Replayed").length, tried: Y.tried,
  };
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const day = (s) => `${+s.slice(8, 10)} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+s.slice(5, 7) - 1]}`;

function renderStats() {
  const S = T.map(yearStats);
  if (openYear == null || !S.some((s) => s.year === openYear)) openYear = S[0]?.year;
  const total = S.reduce((n, s) => n + s.hours, 0), sports = S.reduce((n, s) => n + s.sports, 0), games = byId.size;
  const card = (s) => {
    const open = s.year === openYear;
    return `<article class="card${open ? " open" : ""}" style="--c:${yc(s.year)};view-transition-name:card-${s.year}">
      <button class="card-head" data-card="${s.year}" aria-expanded="${open}" aria-controls="cd-${s.year}">
        <span class="cy num">${s.year}</span><span class="cm num">${open ? `${s.games} games` : `${s.hours.toLocaleString()} h<span class="sep" aria-hidden="true">·</span>${s.games} games`}</span>
      </button>
      <div class="card-body" id="cd-${s.year}" ${open ? "" : "hidden"}>
        <p class="fare num">${s.hours.toLocaleString()}<small>hours</small></p>
        ${s.top ? `<button class="trip" data-open="${s.top.id}">${art(s.top, 140)}<span><small>Top game</small>${esc(s.top.name)}<small class="num">${hrs(s.top.yh)} that year</small></span></button>` : ""}
        <div class="split" role="img" aria-label="Story ${pct(s.story, s.hours)} percent, sports ${pct(s.sports, s.hours)} percent">
          <span style="flex:${s.story}"></span><span style="flex:${s.sports}"></span></div>
        <p class="split-l num"><span>Story ${pct(s.story, s.hours)}%</span><span>Sports ${pct(s.sports, s.hours)}%</span></p>
        <dl class="moments">
          ${s.first ? `<div><dt>First new game</dt><dd><button data-open="${s.first.id}">${esc(s.first.name)}</button><span class="when">${day(s.first.first)}</span></dd></div>` : ""}
          ${s.last ? `<div><dt>Last new game</dt><dd><button data-open="${s.last.id}">${esc(s.last.name)}</button><span class="when">${day(s.last.first)}</span></dd></div>` : ""}
          <div><dt>Came back to</dt><dd class="num">${s.back} game${s.back === 1 ? "" : "s"}${s.replays ? ` · ${s.replays} replayed` : ""}</dd></div>
          <div><dt>Tried</dt><dd class="num">${s.tried} for under an hour</dd></div>
        </dl>
      </div></article>`;
  };
  $("#stats").innerHTML = `<header class="st-top"><button class="icon-btn" data-back aria-label="Back to timeline">${ICON.back}</button><h1 id="stats-title" tabindex="-1">Stats</h1></header>
    <p class="st-sum num"><b>${total.toLocaleString()} h</b> on PlayStation since ${S.at(-1)?.year ?? ""} · ${games} games</p>
    <div class="split life" role="img" aria-label="All years: story ${pct(total - sports, total)} percent, sports ${pct(sports, total)} percent"><span style="flex:${total - sports}"></span><span style="flex:${sports}"></span></div>
    <p class="split-l life num"><span>Story ${(total - sports).toLocaleString()} h</span><span>Sports ${sports.toLocaleString()} h</span></p>
    <div class="wallet">${S.map(card).join("")}</div>
    <p class="st-note">Hours per year are estimates up to 18 Nov 2026 (split using trophy dates). From then on, every sync records them exactly.</p>`;
}
function showView() {
  const stats = location.hash === "#stats";
  document.body.classList.toggle("in-stats", stats);
  $("#stats").hidden = !stats; $("#line").hidden = stats;
  if (stats) { renderStats(); scrollTo(0, 0); $("#stats-title")?.focus({ preventScroll: true }); }
}
addEventListener("hashchange", showView);
function openCard(year) {
  const swap = () => {
    openYear = year; renderStats();
    const c = document.querySelector(`[data-card="${year}"]`);
    c?.closest(".card").scrollIntoView({ block: "nearest" }); c?.focus({ preventScroll: true });
  };
  document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches ? document.startViewTransition(swap) : swap();
}

// ---------------------------------------------------------------- settings
function openMe() {
  const d = $("#me"), end = link?.refresh_expires_at ? new Date(link.refresh_expires_at) : null;
  const connected = !!end && link?.last_sync_status !== "expired";
  d.innerHTML = `<div class="grab" aria-hidden="true"></div><h2 class="s-title">Settings</h2>
    <section class="s-block"><h3>PlayStation</h3>
      <p>${connected ? "Connected · the Mac mini renews the sign-in every morning" : "Not connected"}</p>
      <p class="quiet">${link?.last_sync_at ? `Last sync ${ago(Date.parse(link.last_sync_at))}` : "Never synced"}</p>
      <button class="go" data-sync-now>Sync now</button>
      <details class="paste"><summary>Paste a new PlayStation token</summary>
        <p class="quiet">Only needed if the Mac mini keeper can't reconnect. Open the PlayStation token page while signed in, copy everything, paste it here.</p>
        <textarea id="npsso" rows="3" autocomplete="off" spellcheck="false" aria-label="PlayStation token"></textarea>
        <button class="go" data-connect>Connect</button><p class="err" role="alert"></p></details>
      ${connected ? `<button class="danger" data-disconnect>Disconnect PlayStation</button>` : ""}
    </section>
    <section class="s-block"><h3>Sign in another device</h3>
      <p class="quiet">Shows a 6-digit code. Type it into Save Points on your iPhone or another computer. Works once, for 5 minutes.</p>
      <div id="pair-out"></div><button class="go" data-pair>Show a code</button></section>
    <section class="s-block"><h3>Account</h3><p>${esc(user?.email ?? "")}</p>
      <button class="link" data-signout>Sign out</button></section>
    <button class="done" data-close>Done</button>`;
  d.showModal();
}

// ---------------------------------------------------------------- events
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("button, a"); if (!t) return;
  if (t.dataset.open) return openGame(t.dataset.open);
  if (t.dataset.rate) return openGame(t.dataset.rate, true);
  if (t.hasAttribute("data-map")) return openMap();
  if (t.hasAttribute("data-close")) return t.closest("dialog").close();
  if (t.hasAttribute("data-more")) { t.previousElementSibling.hidden = false; t.remove(); return; }
  if (t.classList.contains("tried-btn")) {
    const open = t.getAttribute("aria-expanded") !== "true";
    t.setAttribute("aria-expanded", open); document.getElementById(t.getAttribute("aria-controls")).hidden = !open; return;
  }
  if (t.id === "ann") { if (t.classList.contains("bad") && annState() === "expired") return openMe(); if (!t.classList.contains("busy")) sync(); return; }
  if (t.id === "add") return toast("Adding a game by hand comes in a later step.");
  if (t.id === "settings") return openMe();
  if (t.id === "stats-btn") { statsPushed = true; location.hash = "stats"; return; }
  if (t.hasAttribute("data-back")) { statsPushed ? history.back() : history.replaceState(null, "", location.pathname + location.search); statsPushed = false; showView(); return; }
  if (t.dataset.card) return openCard(+t.dataset.card);
  if (t.hasAttribute("data-sync-now")) { $("#me").close(); return sync(); }
  if (t.hasAttribute("data-connect")) return connect(t);
  if (t.hasAttribute("data-pair")) return showPairCode(t);
  if (t.hasAttribute("data-disconnect")) return disconnect();
  if (t.hasAttribute("data-signout")) { store.signOut().then(() => { $("#me").close(); T = []; signIn(); }); return; }
  if (t.closest("#map") && t.hash) {
    ev.preventDefault(); $("#map").close();
    const tgt = document.querySelector(t.hash), h = tgt.querySelector(".year");
    h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); // land focus on the station, not the line button
    requestAnimationFrame(() => {
      tgt.scrollIntoView({ behavior: "instant", block: "start" });
      tgt.classList.remove("arrive"); void tgt.offsetWidth; tgt.classList.add("arrive"); // train arriving at the station
    });
  }
});
for (const d of document.querySelectorAll("dialog"))
  d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); }); // tap outside closes

async function connect(btn) {
  const err = btn.parentElement.querySelector(".err"); err.textContent = "";
  btn.disabled = true; btn.textContent = "Connecting…";
  const out = await store.connectPsn($("#npsso").value);
  btn.disabled = false; btn.textContent = "Connect";
  if (!out.connected) { err.textContent = out.error ?? "That didn't work. Try a fresh token."; return; }
  $("#me").close(); toast("PlayStation connected"); setLibrary(await store.fetchLibrary()); sync();
}
async function showPairCode(btn) {
  btn.disabled = true; btn.textContent = "Making a code…";
  try {
    const { code, expiresAt } = await store.createPairCode();
    $("#pair-out").innerHTML = `<p class="pair-code num" aria-label="Code ${code.split("").join(" ")}">${code.slice(0, 3)} ${code.slice(3)}</p>
      <p class="quiet" id="pair-left"></p>`;
    btn.textContent = "Make a new code";
    clearInterval(showPairCode.t);
    showPairCode.t = setInterval(() => {
      const s = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000));
      const el = $("#pair-left"); if (!el) return clearInterval(showPairCode.t);
      el.textContent = s ? `Expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "Expired. Make a new code.";
      if (!s) clearInterval(showPairCode.t);
    }, 1000);
  } catch (e) { $("#pair-out").innerHTML = `<p class="err">${esc(e.message)}</p>`; btn.textContent = "Show a code"; }
  btn.disabled = false;
}
async function disconnect() {
  if (!confirm("Disconnect PlayStation? Your games and ratings stay; hours stop updating until you reconnect.")) return;
  await store.disconnectPsn(); setLibrary(await store.fetchLibrary()); $("#me").close(); render(); toast("PlayStation disconnected");
}

function toast(msg) {
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.append(el); setTimeout(() => el.remove(), 2600);
}

// ---------------------------------------------------------------- start
document.body.insertAdjacentHTML("beforeend", '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><clipPath id="half" clipPathUnits="userSpaceOnUse"><rect width="12" height="24"/></clipPath></svg>');
function setLibrary(lib) {
  ratings = lib.ratings ?? {}; link = lib.link ?? null;
  T = store.timeline(lib);
  byId.clear();
  for (const Y of T) for (const g of Y.games) {
    const e = byId.get(g.id) || { game: g, years: [] };
    e.years.push({ year: Y.year, label: g.label, star: g.star });
    if (g.star) e.game = g;
    byId.set(g.id, e);
  }
  for (const e of byId.values()) e.years.sort((a, b) => a.year - b.year);
}

async function start() {
  const c = store.cached();
  user = await store.currentUser();
  if (!user) return signIn();
  document.body.classList.remove("out");
  if (DEMO_STATE === "importing") return importing();
  if (c) { setLibrary(c); render(); }          // instant paint from the last visit
  else screen(`<h1>Loading your games…</h1>`);
  try {
    setLibrary(await store.fetchLibrary()); render(); store.flush();
  } catch { if (!c) return screen(`<h1>Can't reach Save Points</h1><p>Check your connection and open the app again.</p>`); renderAnn("offline"); return; }
  const last = link?.last_sync_at ? Date.parse(link.last_sync_at) : 0;
  if (!store.demo && navigator.onLine && link?.last_sync_status !== "expired" && Date.now() - last > 6 * 3600e3) sync(); // at most every 6 h
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is a bonus */ });
addEventListener("online", () => { renderAnn(annState(), lastExtra); store.flush(); });
addEventListener("offline", () => renderAnn("offline"));
start();
