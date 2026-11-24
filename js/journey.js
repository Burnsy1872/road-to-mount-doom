/**
 * The route, in map space.
 *
 * Coordinates are percentages of the map image (x of width, y of height).
 * `km` is distance from Hobbiton. The marker is interpolated along the
 * polyline *by distance*, so the dot sits at Rivendell exactly when the
 * ledger reads 700 km — the bar and the map can never disagree.
 *
 * Anchors were read off the map itself (labels + settlement markers),
 * not invented, so the road follows the geography.
 */

export const MAP_W = 2000;
export const MAP_H = 1091;
export const LEAGUE_KM = 4.828; // 1 league ≈ 4.828 km

/** Labelled waymarks. `major` pins keep their label visible on the map. */
export const WAYPOINTS = [
  { name: "Hobbiton",      km: 0,    x: 31.6, y: 27.8, major: true,  note: "Where the road begins" },
  { name: "Bree",          km: 100,  x: 37.0, y: 28.6, major: false, note: "The Prancing Pony" },
  { name: "Weathertop",    km: 300,  x: 42.6, y: 22.2, major: false, note: "Amon Sûl, where the Ringwraiths came" },
  { name: "Rivendell",     km: 700,  x: 48.9, y: 26.9, major: true,  note: "The Last Homely House" },
  { name: "Moria",         km: 1100, x: 50.5, y: 39.6, major: false, note: "Khazad-dûm, under the mountains" },
  { name: "Lothlórien",    km: 1300, x: 53.6, y: 43.0, major: true,  note: "The Golden Wood" },
  { name: "Rauros",        km: 1750, x: 56.9, y: 61.4, major: false, note: "The Falls, where the Fellowship broke" },
  { name: "Rohan",         km: 2000, x: 53.2, y: 67.6, major: true,  note: "Edoras and the Mark" },
  { name: "Minas Tirith",  km: 2500, x: 60.7, y: 71.2, major: false, note: "The White City" },
  { name: "Mount Doom",    km: 2863, x: 65.2, y: 68.6, major: true,  side: "right", note: "Orodruin, the end of the road" },
];

/**
 * The full polyline, including unnamed bends that keep the line on the
 * roads and rivers rather than cutting across country.
 */
export const ROUTE = [
  { km: 0,    x: 31.6, y: 27.8 }, // Hobbiton
  { km: 45,   x: 34.2, y: 28.2 }, // the East Road
  { km: 100,  x: 37.0, y: 28.6 }, // Bree
  { km: 190,  x: 39.6, y: 26.4 },
  { km: 300,  x: 42.6, y: 22.2 }, // Weathertop
  { km: 470,  x: 45.4, y: 24.6 },
  { km: 700,  x: 48.9, y: 26.9 }, // Rivendell
  { km: 900,  x: 49.8, y: 33.2 }, // under the Misty Mountains
  { km: 1100, x: 50.5, y: 39.6 }, // Moria
  { km: 1300, x: 53.6, y: 43.0 }, // Lothlórien
  { km: 1480, x: 54.6, y: 49.0 }, // down the Anduin
  { km: 1620, x: 55.8, y: 55.5 },
  { km: 1750, x: 56.9, y: 61.4 }, // Rauros
  { km: 1850, x: 55.2, y: 64.8 },
  { km: 2000, x: 53.2, y: 67.6 }, // Edoras
  { km: 2250, x: 56.2, y: 70.2 },
  { km: 2500, x: 60.7, y: 71.2 }, // Minas Tirith
  { km: 2680, x: 62.9, y: 70.4 },
  { km: 2863, x: 65.2, y: 68.6 }, // Mount Doom
];

export const GOAL_KM = ROUTE[ROUTE.length - 1].km;

/** Percentage point → SVG user units (the viewBox is the image size). */
export function toSvg(p) {
  return { x: (p.x / 100) * MAP_W, y: (p.y / 100) * MAP_H };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Position along the route at a given distance. */
export function pointAt(km) {
  const d = clamp(km, 0, GOAL_KM);
  for (let i = 1; i < ROUTE.length; i++) {
    const a = ROUTE[i - 1];
    const b = ROUTE[i];
    if (d <= b.km) {
      const t = b.km === a.km ? 0 : (d - a.km) / (b.km - a.km);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        km: d,
      };
    }
  }
  const last = ROUTE[ROUTE.length - 1];
  return { x: last.x, y: last.y, km: GOAL_KM };
}

const seg = (a, b) => {
  const p = toSvg(a);
  const q = toSvg(b);
  return `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
};

/** SVG path for the whole road. */
export function fullPath() {
  const start = toSvg(ROUTE[0]);
  return `M${start.x.toFixed(1)} ${start.y.toFixed(1)} ` +
    ROUTE.slice(1).map((p, i) => seg(ROUTE[i], p)).join(" ");
}

/** SVG path for the portion already walked, ending at `km`. */
export function travelledPath(km) {
  const d = clamp(km, 0, GOAL_KM);
  const start = toSvg(ROUTE[0]);
  let out = `M${start.x.toFixed(1)} ${start.y.toFixed(1)}`;
  for (let i = 1; i < ROUTE.length; i++) {
    const a = ROUTE[i - 1];
    const b = ROUTE[i];
    if (d >= b.km) {
      out += " " + seg(a, b);
    } else {
      const end = pointAt(d);
      out += " " + seg(a, end);
      break;
    }
  }
  return out;
}

/** Which waymark is next, and which have been passed. */
export function waypointStates(km) {
  const next = WAYPOINTS.find((w) => w.km > km) || null;
  return WAYPOINTS.map((w) => ({
    ...w,
    state: w.km <= km ? "passed" : (next && w.km === next.km ? "next" : "ahead"),
  }));
}

/** Label side, so pins near the map edge don't overflow it. */
export function pinSide(p) {
  if (p.side) return p.side;
  return p.y > 76 ? "up" : "";
}
