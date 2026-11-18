// Save Points — The Line. Prototype app shell (local data, ratings in localStorage).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const params = new URLSearchParams(location.search);
const DEMO_STATE = params.get("state"); // importing | syncing | syncfail | expired | offline

const STAR = "M12 2.6l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z";
const ICON = {
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}" fill="currentColor"/><path class="h" d="${STAR}" fill="transparent" clip-path="url(#half)"/></svg>`,
};
const CATS = [["s", "Story"], ["g", "Gameplay"], ["m", "Music"], ["a", "Atmosphere"]];

let T = [];               // years, newest first
const byId = new Map();   // id -> { game (any entry), years: [{year,label,star}] }
let ratings = load("sp.ratings", {});
let lastSync = load("sp.lastSync", Date.now() - 2 * 60 * 1000);

function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const yc = (y) => (y >= 2018 && y <= 2026 ? `var(--y${y})` : "var(--y-other)");
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
          <span class="p num"><span id="now-h">${hrs(g.h)}</span> · since ${g.main}</span></button>
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
const yearLabel = (g, y) => (g.label === "Played" && !g.star ? (g.main < y ? "Played again" : "First go") : g.label);
function ret(g, y) {
  return `<button class="x" data-open="${g.id}">${art(g, 120)}<span class="n"><span>${esc(g.name)}</span><small class="num">${yearLabel(g, y)} · ~${hrs(g.yh)} this year</small></span>
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
  if (state === "offline") { a.innerHTML = `${ICON.sync}<span>Offline · showing what you had ${ago(lastSync)}</span>`; return; }
  a.innerHTML = `${ICON.sync}<span>Synced ${ago(lastSync)}${extra ? ` · <b>${esc(extra)}</b>` : ""}</span>`;
}

function render() {
  $("#line").innerHTML = T.map(station).join("");
  renderAnn(DEMO_STATE && DEMO_STATE !== "importing" ? DEMO_STATE : "idle", "NBA 2K26 +1.2 h");
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
    if (!cur.classList.contains("here")) { stns.forEach((s) => s.classList.remove("here")); cur.classList.add("here"); }
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(mark); } }, { passive: true });
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
      <p class="num">${hrs(g.h)} · ${g.plat} · ${fmtDate(g.first)} – ${fmtDate(g.last)}</p></div></div>
    <div class="g-years">${e.years.map((x) => `<span class="l"><span class="pill" style="--pc:${yc(x.year)}">${x.year}</span>${x.label}${x.star ? " · main year" : ""}</span>`).join("")}</div>
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
    save("sp.ratings", ratings); paint(el, v);
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
function openMap() {
  const here = $(".stn.here")?.dataset.year;
  const d = $("#map");
  d.innerHTML = `<h2>Line map</h2><ol>${T.map((Y) => `<li style="--c:${yc(Y.year)}"><a href="#y${Y.year}" aria-current="${String(Y.year) === here}">
      <strong>${Y.year}</strong><small class="num">${Y.count} games<br>${Y.hours.toLocaleString()} h</small></a></li>`).join("")}</ol>`;
  d.showModal();
  d.querySelector('[aria-current="true"]')?.focus();
}

// ---------------------------------------------------------------- sync (simulated in the prototype)
function sync() {
  renderAnn("syncing");
  setTimeout(() => {
    lastSync = Date.now(); save("sp.lastSync", lastSync);
    renderAnn("idle", "NBA 2K26 +1.2 h");
    const h = $("#now-h");
    if (h && !h.nextElementSibling) h.insertAdjacentHTML("afterend", `<span class="delta">+1.2 h</span>`);
  }, 1600);
}

// ---------------------------------------------------------------- first run
function boot() {
  const total = byId.size;
  $("#line").innerHTML = `<section class="boot" style="--p:10%"><h1>Importing your games</h1>
    <p>From PlayStation · <span class="count" id="cnt">0</span> of ${total}</p></section>`;
  let n = 0;
  const t = setInterval(() => {
    n = Math.min(total, n + 9);
    $("#cnt").textContent = n;
    $(".boot").style.setProperty("--p", `${10 + 80 * (n / total)}%`);
    if (n >= total) { clearInterval(t); setTimeout(render, 500); }
  }, 60);
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
  if (t.id === "ann") { if (!t.classList.contains("busy")) sync(); return; }
  if (t.id === "add") return toast("Adding a game by hand comes in a later step.");
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

function toast(msg) {
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.append(el); setTimeout(() => el.remove(), 2600);
}

// ---------------------------------------------------------------- start
document.body.insertAdjacentHTML("beforeend", '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><clipPath id="half" clipPathUnits="userSpaceOnUse"><rect width="12" height="24"/></clipPath></svg>');
fetch("data/timeline.json").then((r) => r.json()).then((data) => {
  T = data;
  for (const Y of T) for (const g of Y.games) {
    const e = byId.get(g.id) || { game: g, years: [] };
    e.years.push({ year: Y.year, label: g.label, star: g.star });
    if (g.star) e.game = g;
    byId.set(g.id, e);
  }
  for (const e of byId.values()) e.years.sort((a, b) => a.year - b.year);
  DEMO_STATE === "importing" ? boot() : render();
});
