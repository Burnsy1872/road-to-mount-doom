/**
 * The Road to Mount Doom — page renderer.
 *
 * Everything on the page is derived from data/data.json. There are no
 * numbers baked into the markup, so the site can never contradict itself.
 */

import {
  WAYPOINTS, GOAL_KM, LEAGUE_KM,
  pointAt, toSvg, fullPath, travelledPath, waypointStates, pinSide,
} from "./journey.js";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const num = (v, dec = 0) =>
  new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(Number.isFinite(v) ? v : 0);

/** "2026-11-23" or "2026-11-23T17:30:00Z" → local Date (time ignored). */
function parseDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d, withYear = false) {
  if (!d) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}`;
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

const daysBetween = (from, to) =>
  Math.max(0, Math.round((to - from) / 86400000));

/** Round a maximum up to a friendly axis value. */
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

document.documentElement.classList.add("js");
init();

async function init() {
  let data;
  try {
    data = await loadData();
  } catch (err) {
    showError(err);
    return;
  }

  try {
    renderJourney(data);
    renderQuote(data);
    renderMap(data);
    renderStats(data);
    renderBalance(data);
    renderQuests(data);
    renderChart(data.weeks || []);
    renderRecords(data.records || []);
    renderFeed(data.activities || []);
    renderFooter(data);
    initReveal();
    initScroll();
  } catch (err) {
    console.error(err);
    showError(err);
  }
}

async function loadData() {
  const res = await fetch("data/data.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load data/data.json (HTTP ${res.status}).`);
  return res.json();
}

function showError(err) {
  const main = $("#main");
  if (!main) return;
  main.insertAdjacentHTML("afterbegin", `
    <div class="wrap">
      <p class="noscript" role="alert">
        <strong>The ledger could not be read.</strong><br>
        ${String(err && err.message || err)}<br>
        <small>If you opened this file directly, run a local server instead:
        <code>python -m http.server</code></small>
      </p>
    </div>`);
}

/* ------------------------------------------------------------------ */
/* journey                                                             */
/* ------------------------------------------------------------------ */

function renderJourney(data) {
  const j = data.journey || {};
  const km = Number(j.km) || 0;
  const goal = Number(j.goal_km) || GOAL_KM;
  const pct = Math.min(100, Math.max(0, (km / goal) * 100));

  const start = parseDate(j.start);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = start ? daysBetween(start, today) + 1 : 0;

  $("#journey-day").textContent = day > 0 ? `· day ${num(day)}` : "";
  $("#journey-km").textContent = num(km, 1);
  $("#journey-goal").textContent =
    `of ${num(goal)} km · ${num(goal / LEAGUE_KM, 0)} leagues`;
  $("#journey-leagues").textContent =
    `≈ ${num(km / LEAGUE_KM, 1)} leagues of road`;

  // waymark ticks along the bar
  const ticks = $("#track-ticks");
  ticks.textContent = "";
  const states = waypointStates(km);
  states.forEach((w) => {
    const tick = document.createElement("span");
    tick.style.left = `${(w.km / goal) * 100}%`;
    if (w.state === "passed") tick.classList.add("is-passed");
    if (w.state === "next") tick.classList.add("is-next");
    tick.title = `${w.name} — ${num(w.km)} km`;
    ticks.appendChild(tick);
  });

  // next waymark + pace
  const next = states.find((w) => w.state === "next");
  const nextEl = $("#journey-next");
  const paceEl = $("#journey-pace");

  if (next) {
    nextEl.innerHTML =
      `Next waymark: <b>${next.name}</b> — ${num(next.km - km, 1)} km ahead.`;
  } else {
    nextEl.innerHTML = `<b>The fire is reached.</b> The Ring is unmade.`;
  }

  if (km <= 0) {
    paceEl.textContent = "The first league is yet to be walked.";
  } else if (day > 0) {
    const perDay = km / day;
    const left = Math.max(0, goal - km);
    if (left === 0) {
      paceEl.textContent = `${num(perDay, 1)} km/day across ${num(day)} days. The road is walked.`;
    } else {
      const eta = new Date(today.getTime() + Math.ceil(left / perDay) * 86400000);
      paceEl.textContent =
        `${num(perDay, 1)} km/day · at this pace Orodruin is reached around ${fmtDate(eta, true)}.`;
    }
  }

  const track = $("#journey-track");
  track.setAttribute("aria-valuenow", pct.toFixed(1));
  track.setAttribute("aria-valuetext",
    `${num(km, 1)} of ${num(goal)} kilometres, ${pct.toFixed(1)} percent`);

  $("#nav-chip").textContent = `${pct.toFixed(1)}%`;

  const apply = () => {
    $("#track-fill").style.width = `${pct}%`;
    $("#track-head").style.left = `${pct}%`;
  };
  if (reduceMotion) apply();
  else requestAnimationFrame(() => setTimeout(apply, 250));

  if (!reduceMotion) countUp($("#journey-km"), km, 1, 1200);
}

/* ------------------------------------------------------------------ */
/* map                                                                 */
/* ------------------------------------------------------------------ */

function renderMap(data) {
  const km = Number(data.journey && data.journey.km) || 0;

  const road = fullPath();
  $("#route-casing").setAttribute("d", road);
  $("#route-full").setAttribute("d", road);

  const travelled = $("#route-travelled");
  travelled.setAttribute("d", travelledPath(km));

  if (!reduceMotion && typeof travelled.getTotalLength === "function") {
    const len = travelled.getTotalLength();
    travelled.style.strokeDasharray = String(len);
    travelled.style.strokeDashoffset = String(len);
    requestAnimationFrame(() => {
      travelled.style.transition = "stroke-dashoffset 2s cubic-bezier(.22,.61,.36,1)";
      travelled.style.strokeDashoffset = "0";
    });
  }

  // marker
  const marker = $("#map-marker");
  const target = toSvg(pointAt(km));
  const place = (p) => marker.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);

  if (reduceMotion) {
    place(target);
  } else {
    place(toSvg(pointAt(0)));
    requestAnimationFrame(() => setTimeout(() => place(target), 260));
  }

  // keep the marker legible when the map shrinks to phone width
  const frame = $(".map-frame");
  const markerScale = $("#marker-scale");
  const sizeMarker = () => {
    const w = frame.clientWidth || 1000;
    const s = Math.max(1, Math.min(3.2, 1080 / w));
    markerScale.setAttribute("transform", `scale(${s.toFixed(2)})`);
  };
  sizeMarker();
  if ("ResizeObserver" in window) {
    if (window.__mapRO) window.__mapRO.disconnect();
    window.__mapRO = new ResizeObserver(sizeMarker);
    window.__mapRO.observe(frame);
  }

  // pins
  const pins = $("#map-pins");
  const waypoints = $("#map-waypoints");
  pins.textContent = "";
  waypoints.textContent = "";
  waypointStates(km).forEach((w) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `pin is-${w.state}`;
    btn.style.left = `${w.x}%`;
    btn.style.top = `${w.y}%`;
    if (w.major) btn.dataset.major = "";

    // the "next" waymark shows its label above the dot, clear of the major
    // waymark sitting just beyond it
    const side = w.state === "next" ? "up" : pinSide(w);
    if (side) btn.dataset.side = side;
    btn.dataset.tip = w.y < 32 ? "below" : "above";

    const stateText = w.state === "passed" ? "passed" : w.state === "next" ? "next" : "ahead";
    btn.setAttribute("aria-label", `${w.name}, ${num(w.km)} km — ${stateText}`);

    btn.innerHTML = `
      <span class="pin-tip" aria-hidden="true">${w.name} · ${num(w.km)} km<em>${w.note}</em></span>
      <span class="pin-dot"></span>
      <span class="pin-label">${w.name}</span>`;
    pins.appendChild(btn);

    const li = document.createElement("li");
    li.className = `is-${w.state}`;
    li.innerHTML = `<span class="wp-name">${w.name}</span><span class="wp-km">${num(w.km)} km</span>`;
    waypoints.appendChild(li);
  });

  $("#map-caption-km").textContent = num(km, 1);
}

/* ------------------------------------------------------------------ */
/* ledger                                                              */
/* ------------------------------------------------------------------ */

function renderStats(data) {
  const t = data.totals || {};
  const foot  = t.foot  || {};
  const wheel = t.wheel || {};
  const all   = t.all   || {};

  const groups = [
    {
      grid: $("#stat-foot"),
      cards: [
        {
          label: "Distance", value: foot.km, unit: "km", dec: 1,
          caption: `${num(foot.activities)} runs`, accent: "var(--moss)",
        },
        {
          label: "Ascent", value: foot.elev_m, unit: "m", dec: 0,
          caption: "climbed on foot", accent: "var(--moss-dark)",
        },
        {
          label: "Time", value: (foot.time_s || 0) / 3600, unit: "h", dec: 1,
          caption: "on the road", accent: "var(--bronze)",
        },
      ],
    },
    {
      grid: $("#stat-wheel"),
      cards: [
        {
          label: "Distance", value: wheel.km, unit: "km", dec: 1,
          caption: `${num(wheel.activities)} rides`, accent: "var(--amber)",
        },
        {
          label: "Ascent", value: wheel.elev_m, unit: "m", dec: 0,
          caption: "climbed in the saddle", accent: "var(--gold)",
        },
        {
          label: "Time", value: (wheel.time_s || 0) / 3600, unit: "h", dec: 1,
          caption: "in the saddle", accent: "var(--bronze-dark)",
        },
      ],
    },
  ];

  groups.forEach(({ grid, cards }) => {
    grid.textContent = "";
    cards.forEach((c) => {
      const el = document.createElement("article");
      el.className = "stat-card";
      el.style.setProperty("--accent", c.accent);
      el.innerHTML = `
        <p class="stat-label">${c.label}</p>
        <p class="stat-value">
          <span class="stat-num" data-target="${c.value || 0}" data-dec="${c.dec}">0</span>
          ${c.unit ? `<span class="stat-unit">${c.unit}</span>` : ""}
        </p>
        <p class="stat-caption">${c.caption}</p>`;
      grid.appendChild(el);
    });
  });

  $("#ledger-total").textContent =
    `${num(all.activities)} sessions · ${num(all.active_days)} active days · ` +
    `${num(all.elev_m)} m climbed across both.`;

  // animate when the section is scrolled into view
  const animate = () => $$(".stat-num", $("#ledger")).forEach((el) => {
    countUp(el, Number(el.dataset.target), Number(el.dataset.dec), 900);
  });

  if (reduceMotion || !("IntersectionObserver" in window)) {
    animate();
  } else {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { animate(); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe($("#ledger"));
  }
}

function renderBalance(data) {
  const t = data.totals || {};
  const foot = t.foot || {};
  const wheel = t.wheel || {};
  const card = $("#balance-card");
  const rows = $("#balance-rows");

  const metrics = [
    { label: "Distance", foot: foot.km || 0, wheel: wheel.km || 0, unit: "km", dec: 1 },
    { label: "Ascent",   foot: foot.elev_m || 0, wheel: wheel.elev_m || 0, unit: "m", dec: 0 },
    { label: "Hours",    foot: (foot.time_s || 0) / 3600, wheel: (wheel.time_s || 0) / 3600, unit: "h", dec: 1 },
  ];

  const total = metrics[0].foot + metrics[0].wheel;
  if (total <= 0) { card.hidden = true; return; }
  card.hidden = false;

  rows.textContent = "";
  const shares = [];
  metrics.forEach((m) => {
    const sum = m.foot + m.wheel;
    const footPct = sum > 0 ? (m.foot / sum) * 100 : 50;
    shares.push(footPct);

    const row = document.createElement("div");
    row.className = "balance-row";
    row.innerHTML = `
      <span class="balance-row-label">${m.label}</span>
      <span class="balance-track" title="On foot ${num(m.foot, m.dec)} ${m.unit} · on wheels ${num(m.wheel, m.dec)} ${m.unit}">
        <span class="balance-foot"><span>${Math.round(footPct)}%</span></span>
        <span class="balance-wheel"><span>${Math.round(100 - footPct)}%</span></span>
      </span>
      <span class="balance-total">${num(sum, m.dec)} ${m.unit}</span>`;
    rows.appendChild(row);
  });

  const paint = () => {
    $$(".balance-row", rows).forEach((row, i) => {
      const p = shares[i];
      $(".balance-foot", row).style.width = `${p.toFixed(2)}%`;
      $(".balance-wheel", row).style.width = `${(100 - p).toFixed(2)}%`;
    });
  };

  if (reduceMotion || !("IntersectionObserver" in window)) paint();
  else {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { paint(); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(card);
  }

  $("#balance-note").innerHTML =
    `Your feet have carried <b>${Math.round(shares[0])}%</b> of the distance and ` +
    `<b>${Math.round(shares[2])}%</b> of the hours; your wheels have taken ` +
    `<b>${Math.round(100 - shares[1])}%</b> of the climbing.`;
}

/* ------------------------------------------------------------------ */
/* quests: this week + monthly oaths                                   */
/* ------------------------------------------------------------------ */

function lastOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function renderQuests(data) {
  const week = data.periods && data.periods.week;
  const month = data.periods && data.periods.month;
  if (!week && !month) { $("#quests").hidden = true; return; }

  const generated = data.generated_at ? new Date(data.generated_at) : new Date();
  const now = Number.isNaN(generated.getTime()) ? new Date() : generated;

  if (week) {
    const start = parseDate(week.start);
    const end = start
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
      : null;
    const dayNo = start
      ? Math.min(7, Math.max(1, Math.floor((now - start) / 86400000) + 1))
      : 0;

    $("#week-range").textContent = start
      ? `${fmtDate(start)} – ${fmtDate(end)} · day ${dayNo} of 7`
      : "";

    const groups = [
      {
        grid: $("#week-foot"),
        cards: [
          { label: "Distance", value: week.foot_km, unit: "km", dec: 1,
            caption: "distance on foot", accent: "var(--moss)" },
          { label: "Ascent", value: week.foot_elev_m, unit: "m", dec: 0,
            caption: "climbed on the way", accent: "var(--moss-dark)" },
        ],
      },
      {
        grid: $("#week-wheel"),
        cards: [
          { label: "Distance", value: week.wheel_km, unit: "km", dec: 1,
            caption: "distance in the saddle", accent: "var(--amber)" },
          { label: "Ascent", value: week.wheel_elev_m, unit: "m", dec: 0,
            caption: "climbed on the ride", accent: "var(--gold)" },
        ],
      },
    ];

    groups.forEach(({ grid, cards }) => {
      grid.textContent = "";
      cards.forEach((c) => {
        const el = document.createElement("article");
        el.className = "stat-card";
        el.style.setProperty("--accent", c.accent);
        el.innerHTML = `
          <p class="stat-label">${c.label}</p>
          <p class="stat-value">
            <span class="stat-num">${num(c.value || 0, c.dec)}</span>
            <span class="stat-unit">${c.unit}</span>
          </p>
          <p class="stat-caption">${c.caption}</p>`;
        grid.appendChild(el);
      });
    });

    const secs = (week.foot_time_s || 0) + (week.wheel_time_s || 0);
    const km = (week.foot_km || 0) + (week.wheel_km || 0);
    $("#week-note").textContent = (secs || km)
      ? `${fmtDuration(secs)} moving · ${num(km, 1)} km travelled since Monday.`
      : "A quiet week so far — the road is waiting.";
  }

  if (month) {
    const start = parseDate(month.start);
    const end = start ? lastOfMonth(start) : null;
    $("#month-range").textContent = start
      ? `${fmtDate(start)} – ${fmtDate(end)}`
      : "";

    const goals = (data.goals && data.goals.month) || {};
    const oaths = [
      { title: "The Road to Rivendell", value: month.foot_km || 0,
        goal: goals.foot_km, unit: "km", accent: "var(--moss)",
        kept: "The oath is kept — every further kilometre is a gift." },
      { title: "The Ride to Rohan", value: month.wheel_km || 0,
        goal: goals.wheel_km, unit: "km", accent: "var(--amber)",
        kept: "The oath is kept — the Mark is within reach." },
    ].filter((o) => o.goal > 0);

    const grid = $("#oath-grid");
    grid.textContent = "";
    oaths.forEach((o) => {
      const pct = Math.min(100, (o.value / o.goal) * 100);
      const left = Math.max(0, o.goal - o.value);
      const note = left <= 0 ? o.kept
        : pct >= 75 ? `The final stretch — ${num(left, 1)} km left to conquer.`
        : pct >= 50 ? `Past the halfway mark — ${num(left, 1)} km remaining.`
        : `${num(left, 1)} km still to go this month.`;

      const el = document.createElement("article");
      el.className = "oath-card";
      el.style.setProperty("--accent", o.accent);
      el.innerHTML = `
        <div class="oath-top">
          <h4 class="oath-title">${o.title}</h4>
          <span class="oath-pct">${num(pct, 0)}%</span>
        </div>
        <p class="oath-figure"><b>${num(o.value, 1)}</b> <span>/ ${num(o.goal, 0)} ${o.unit} this month</span></p>
        <div class="oath-track" role="progressbar" aria-label="${o.title}"
             aria-valuemin="0" aria-valuemax="${o.goal}" aria-valuenow="${o.value}"
             aria-valuetext="${num(o.value, 1)} of ${num(o.goal, 0)} ${o.unit}">
          <span class="oath-fill" style="width:${pct.toFixed(1)}%"></span>
        </div>
        <p class="oath-note">${note}</p>`;
      grid.appendChild(el);
    });
  }
}

/* ------------------------------------------------------------------ */
/* trends chart                                                        */
/* ------------------------------------------------------------------ */

let chartWeeks = [];

function renderChart(weeks) {
  chartWeeks = weeks;
  const wrap = $("#chart-wrap");
  if (!weeks.length) {
    wrap.closest(".chart-card").hidden = true;
    return;
  }

  drawChart();
  if (!window.__chartRO && "ResizeObserver" in window) {
    let frame = 0;
    window.__chartRO = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(drawChart);
    });
    window.__chartRO.observe(wrap);
  }
}

function drawChart() {
  const weeks = chartWeeks;
  const svg = $("#chart");
  const wrap = $("#chart-wrap");
  const W = Math.max(300, Math.floor(wrap.clientWidth));
  const narrow = W < 560;

  const padL = narrow ? 26 : 38;
  const padR = 6;
  const plotW = W - padL - padR;

  const barTop = 16;
  const barH = narrow ? 116 : 148;
  const elevTop = barTop + barH + 34;
  const elevH = narrow ? 40 : 50;
  const axisY = elevTop + elevH;
  const labelY = axisY + 18;
  const H = labelY + 8;

  const totals = weeks.map((w) => (w.foot_km || 0) + (w.wheel_km || 0));
  const maxKm = niceMax(Math.max(...totals, 1));
  const maxElev = niceMax(Math.max(...weeks.map((w) => w.elev_m || 0), 1));

  const colW = plotW / weeks.length;
  const barW = Math.min(36, Math.max(8, colW * 0.56));

  const X = (i) => padL + colW * i + colW / 2;
  const Ykm = (v) => barTop + barH - (v / maxKm) * barH;
  const Yelev = (v) => elevTop + elevH - (v / maxElev) * elevH;

  let out = `
    <defs>
      <linearGradient id="grad-foot" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8fb56a"/>
        <stop offset="100%" stop-color="#5f8442"/>
      </linearGradient>
      <linearGradient id="grad-wheel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d8a545"/>
        <stop offset="100%" stop-color="#a9761f"/>
      </linearGradient>
      <linearGradient id="grad-elev" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(107,74,42,.34)"/>
        <stop offset="100%" stop-color="rgba(107,74,42,.02)"/>
      </linearGradient>
    </defs>`;

  // horizontal grid + km labels
  for (let i = 0; i <= 2; i++) {
    const v = (maxKm / 2) * i;
    const y = Ykm(v);
    out += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
    out += `<text x="${padL - 6}" y="${y + 3.5}" text-anchor="end" font-size="9.5">${num(v)}${i === 2 ? " km" : ""}</text>`;
  }

  // bars
  weeks.forEach((w, i) => {
    const x = X(i) - barW / 2;
    const foot = w.foot_km || 0;
    const wheel = w.wheel_km || 0;
    const hf = (foot / maxKm) * barH;
    const hw = (wheel / maxKm) * barH;

    if (hf > 0) {
      out += `<rect class="bar-foot" x="${x}" y="${Ykm(foot)}" width="${barW}" height="${Math.max(1.5, hf)}" rx="2"/>`;
    }
    if (hw > 0) {
      out += `<rect class="bar-wheel" x="${x}" y="${Ykm(foot + wheel)}" width="${barW}" height="${Math.max(1.5, hw)}" rx="2"/>`;
    }
  });

  // elevation ribbon
  const pts = weeks.map((w, i) => `${X(i)},${Yelev(w.elev_m || 0)}`);
  out += `<path class="elev-area" d="M${padL},${axisY} L${pts.join(" L")} L${W - padR},${axisY} Z"/>`;
  out += `<path class="elev-line" d="M${pts.join(" L")}"/>`;
  out += `<line class="axis-line" x1="${padL}" y1="${axisY}" x2="${W - padR}" y2="${axisY}"/>`;
  out += `<text class="elev-label" x="${padL + 4}" y="${elevTop + 12}" font-size="9">${num(maxElev)} m</text>`;

  // week labels
  const every = narrow ? 3 : 1;
  weeks.forEach((w, i) => {
    if (i % every !== 0 && i !== weeks.length - 1) return;
    const d = parseDate(w.start);
    out += `<text x="${X(i)}" y="${labelY}" text-anchor="middle" font-size="9.5">${d ? d.getDate() + " " + MONTHS[d.getMonth()] : ""}</text>`;
  });

  // hit areas + active column line
  weeks.forEach((w, i) => {
    out += `<rect class="week-hit" data-i="${i}" x="${padL + colW * i}" y="${barTop}" width="${colW}" height="${axisY - barTop}"/>`;
    out += `<line class="col-line" data-line="${i}" x1="${X(i)}" y1="${barTop}" x2="${X(i)}" y2="${axisY}"/>`;
  });

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.style.height = `${H}px`;
  svg.setAttribute("aria-label",
    `Weekly distance and climbing for the last ${weeks.length} weeks. ` +
    `Highest week ${num(Math.max(...totals), 1)} kilometres.`);
  svg.innerHTML = out;

  bindChartHover(svg, weeks, { padL, colW, barTop, W });

  // summary line + table
  const totalKm = totals.reduce((a, b) => a + b, 0);
  const totalElev = weeks.reduce((a, w) => a + (w.elev_m || 0), 0);
  $("#chart-total").textContent =
    `${num(totalKm, 0)} km and ${num(totalElev, 0)} m climbed in ${weeks.length} weeks`;

  const tbody = $("#chart-data-table tbody");
  tbody.textContent = "";
  weeks.forEach((w) => {
    const d = parseDate(w.start);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d ? fmtDate(d, true) : "—"}</td>
      <td>${num(w.foot_km || 0, 1)} km</td>
      <td>${num(w.wheel_km || 0, 1)} km</td>
      <td>${num((w.foot_km || 0) + (w.wheel_km || 0), 1)} km</td>
      <td>${num(w.elev_m || 0)} m</td>`;
    tbody.appendChild(tr);
  });
}

function bindChartHover(svg, weeks, geo) {
  const tip = $("#chart-tip");
  const lines = $$(".col-line", svg);
  const hits = $$(".week-hit", svg);

  const show = (i) => {
    const w = weeks[i];
    const d = parseDate(w.start);
    const foot = w.foot_km || 0;
    const wheel = w.wheel_km || 0;

    tip.innerHTML = `
      <strong>Week of ${d ? fmtDate(d) : "—"}</strong>
      <span><i>On foot</i><b>${num(foot, 1)} km</b></span>
      <span><i>On wheels</i><b>${num(wheel, 1)} km</b></span>
      <span><i>Climbed</i><b>${num(w.elev_m || 0)} m</b></span>`;
    tip.hidden = false;

    const x = Math.min(geo.W - 84, Math.max(84, geo.padL + geo.colW * i + geo.colW / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${geo.barTop + 4}px`;

    lines.forEach((l, n) => l.classList.toggle("is-active", n === i));
  };

  const hide = () => {
    tip.hidden = true;
    lines.forEach((l) => l.classList.remove("is-active"));
  };

  hits.forEach((hit) => {
    hit.addEventListener("pointerenter", () => show(Number(hit.dataset.i)));
    hit.addEventListener("pointerdown", () => show(Number(hit.dataset.i)));
  });
  svg.addEventListener("pointerleave", hide);
}

/* ------------------------------------------------------------------ */
/* records + journal                                                   */
/* ------------------------------------------------------------------ */

function renderRecords(records) {
  const list = $("#record-list");
  if (!records.length) { list.closest(".section").hidden = true; return; }

  list.textContent = "";
  records.forEach((r) => {
    const d = parseDate(r.date);
    const li = document.createElement("li");
    li.className = "record";
    li.innerHTML = `
      <span class="record-label">${r.label}</span>
      <span class="record-value">${num(r.value, r.dec || 0)}<small>${r.unit || ""}</small></span>
      <span class="record-meta">${d ? fmtDate(d, true) : ""}${r.activity ? " · " + r.activity : ""}</span>`;
    list.appendChild(li);
  });
}

/* The journal lines are the original pool from the old ledger, with the
   mislabelled "leagues" corrected to km. The template is chosen by activity
   id, so an entry reads the same every time the data refreshes. */
const RUN_LINES = [
  (km, m) => `A journey of ${km} km on foot, ascending ${m} m of rugged terrain.`,
  (km, m) => `The road goes ever on and on. ${km} km covered, with ${m} m of elevation conquered.`,
  (km, m) => `A swift stride through the wilds! ${km} km travelled, scaling ${m} m of mountains.`,
  (km, m) => `Not all those who wander are lost, but this one covered ${km} km and climbed ${m} m!`,
  (km, m) => `Through shadow and light, ${km} km were walked and ${m} m of mountains scaled.`,
  (km, m) => `A fellowship of one, marching ${km} km and conquering ${m} m of steep ascent.`,
  (km, m) => `The eagles may fly, but you ran ${km} km and climbed ${m} m on your own two feet!`,
  (km, m) => `From the Shire to the edge of the wild: ${km} km on foot, ${m} m of elevation gained.`,
  (km, m) => `A steady pace, a heavy breath, and ${km} km travelled with ${m} m of mountains overcome.`,
  (km, m) => `You have walked where few dare to tread: ${km} km and ${m} m of elevation behind you.`,
  (km, m) => `The path was long and the hills were high: ${km} km covered, ${m} m climbed.`,
  (km, m) => `A true Ranger's pace: ${km} km traversed on foot, ascending ${m} m into the clouds.`,
];

const RIDE_LINES = [
  (km, m) => `A ride across the lands, travelling ${km} km on wheels and conquering ${m} m of elevation.`,
  (km, m) => `Ride out, ride out! ${km} km crossed on two wheels, ascending ${m} m into the sky.`,
  (km, m) => `Like a rider of Rohan, you covered ${km} km and climbed ${m} m of steep terrain.`,
  (km, m) => `The wind in your face and the road beneath you: ${km} km ridden, ${m} m climbed.`,
  (km, m) => `Faster than the horses of the Mark! ${km} km ridden, with ${m} m of elevation conquered.`,
  (km, m) => `A great gallop across the plains: ${km} km covered, scaling ${m} m of mountains.`,
  (km, m) => `The wheels turned and the road flew by: ${km} km travelled, ${m} m of ascent achieved.`,
  (km, m) => `Through the fields of Rohan and beyond: ${km} km on two wheels, ${m} m of elevation gained.`,
  (km, m) => `A swift journey on the wings of the wind: ${km} km ridden, ${m} m climbed.`,
  (km, m) => `The road called, and you answered on two wheels: ${km} km and ${m} m of elevation.`,
  (km, m) => `No shadow could catch you today: ${km} km ridden and ${m} m of mountains scaled.`,
  (km, m) => `A magnificent charge across Middle-earth: ${km} km covered, ${m} m of elevation conquered.`,
];

const WALK_LINES = [
  (km, m) => `A steady pace through the Shire, covering ${km} km with ${m} m of gentle ascent.`,
  (km, m) => `A quiet stroll through the woods. ${km} km walked, gaining ${m} m in height.`,
  (km, m) => `Second breakfast was well earned after this ${km} km walk, climbing ${m} m.`,
];

const FLAT_LINES = {
  foot: [
    (km) => `A flat ${km} km on foot, quick and steady.`,
    (km) => `${km} km underfoot, with the road level and kind.`,
  ],
  wheel: [
    (km) => `${km} km on wheels, flat and fast.`,
    (km) => `The wheels spun ${km} km without a hill in sight.`,
  ],
};

function entryProse(a, km, elev, used) {
  const seed = Number(a.id) || 0;
  const isWheel = a.sport === "wheel";
  const flat = !(Number(a.elev_m) > 0);
  const isWalk = /walk|hike/i.test(String(a.type || ""));
  const key = flat ? `${isWheel ? "wheel" : "foot"}-flat`
    : isWalk ? "walk" : isWheel ? "wheel" : "foot";
  const pool = flat ? FLAT_LINES[isWheel ? "wheel" : "foot"]
    : isWalk ? WALK_LINES : isWheel ? RIDE_LINES : RUN_LINES;

  let seen = used.get(key);
  if (!seen) { seen = new Set(); used.set(key, seen); }

  const start = seed % pool.length;
  for (let n = 0; n < pool.length; n++) {
    const idx = (start + n) % pool.length;
    if (!seen.has(idx)) {
      seen.add(idx);
      return pool[idx](km, elev);
    }
  }
  return pool[start](km, elev);
}

function renderFeed(activities) {
  const feed = $("#feed");
  if (!activities.length) { feed.closest(".section").hidden = true; return; }

  const used = new Map();
  feed.textContent = "";
  activities.forEach((a) => {
    const d = parseDate(a.date);
    const km = num(a.km || 0, 1);
    const elev = num(a.elev_m || 0);
    const li = document.createElement("li");
    li.className = "feed-item";
    li.innerHTML = `
      <time class="feed-date" datetime="${a.date || ""}">${d ? fmtDate(d) : "—"}</time>
      <span class="feed-dot" data-sport="${a.sport || "foot"}" aria-hidden="true"></span>
      <span class="feed-body">
        <span class="feed-prose"><strong>${escapeHtml(a.name || "Untitled")}</strong> — ${entryProse(a, km, elev, used)}</span>
      </span>`;
    feed.appendChild(li);
  });
}

function renderQuote(data) {
  const q = data && data.quote;
  if (!q || !q.text) return;
  const text = $("#quote-text");
  const cite = $("#quote-cite");
  if (text) text.textContent = `\u201C${q.text}\u201D`;
  if (cite) cite.textContent = `— ${q.author || ""}`;
}

function renderFooter(data) {
  const gen = data.generated_at ? new Date(data.generated_at) : null;
  const when = gen && !Number.isNaN(gen.getTime())
    ? `${gen.getDate()} ${MONTHS[gen.getMonth()]} ${gen.getFullYear()}, ` +
      `${String(gen.getHours()).padStart(2, "0")}:${String(gen.getMinutes()).padStart(2, "0")}`
    : "unknown";
  const count = data.totals && data.totals.all ? data.totals.all.activities : 0;
  const isStrava = data.source === "strava";
  $("#footer-source").innerHTML = isStrava
    ? 'Forged in the fires of Orodruin. Data from <a href="https://www.strava.com" rel="noopener">Strava</a>.'
    : "Forged in the fires of Orodruin. Demo data — not your activities.";
  $("#footer-meta").textContent =
    `Ledger updated ${when} · ${num(count)} activities · ${isStrava ? "Strava" : "sample data"}`;
}

/* ------------------------------------------------------------------ */
/* motion + navigation                                                 */
/* ------------------------------------------------------------------ */

function countUp(el, target, dec, duration) {
  if (!el) return;
  if (reduceMotion || !Number.isFinite(target)) {
    el.textContent = num(target, dec);
    return;
  }
  const from = 0;
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = num(from + (target - from) * eased, dec);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function initReveal() {
  if (reduceMotion || !("IntersectionObserver" in window)) return;

  const candidates = $$(
    ".section-head, .stat-card, .chart-card, .record, .balance-card, .oath-card, .journal-card, .map-panel, .journey-card"
  );
  const vh = window.innerHeight;
  const targets = candidates.filter((el) => el.getBoundingClientRect().top > vh * 0.92);

  targets.forEach((el) => el.classList.add("reveal"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

  targets.forEach((el) => io.observe(el));

  // Failsafe for contexts where the observer never fires: reveal anything
  // that scrolls into view, then detach itself.
  const revealVisible = () => {
    const vh = window.innerHeight;
    const left = targets.filter((el) => !el.classList.contains("is-in"));
    if (!left.length) {
      window.removeEventListener("scroll", revealVisible);
      return;
    }
    left.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) el.classList.add("is-in");
    });
  };
  window.addEventListener("scroll", revealVisible, { passive: true });
}

function initScroll() {
  const bar = $("#scroll-progress");
  const links = $$(".nav a");
  const sections = links
    .map((a) => ({ a, el: $(a.getAttribute("href")) }))
    .filter((s) => s.el);

  let queued = false;
  let last = -2;

  const render = () => {
    queued = false;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.width = `${max > 0 ? Math.min(100, (y / max) * 100) : 0}%`;

    let active = -1;
    sections.forEach((s, i) => {
      if (s.el.offsetTop <= y + 120) active = i;
    });
    if (active !== last) {
      last = active;
      links.forEach((a, i) => {
        if (i === active) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }
  };

  const onScroll = () => {
    if (!queued) { queued = true; requestAnimationFrame(render); }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  render();
}

/* ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* Offline shell + installable app. The worker is network-first, so a new
   deploy appears on the next load without changing any version number. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is optional */
    });
  });
}
