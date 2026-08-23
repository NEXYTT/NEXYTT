/**
 * Inline SVG icon set.
 *
 * Icons are inlined rather than loaded from a sprite or an icon font so that
 * every page works offline and from `file://`, and so they inherit `currentColor`
 * without a flash of unstyled content.
 *
 * Paths are drawn on a 24×24 grid, stroke-based, 1.75 units wide.
 */

const PATHS = {
  // --- generic UI
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35",
  cart: "M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.55L21 8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  close: "M18 6 6 18M6 6l12 12",
  check: "m20 6-11 11-5-5",
  chevronRight: "m9 18 6-6-6-6",
  chevronDown: "m6 9 6 6 6-6",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  filter: "M4 6h16M7 12h10M10 18h4",
  star: "m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9L12 2.5Z",
  trash: "M4 7h16M10 11v6m4-6v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9v4m0-8h.01",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  truck: "M3 16V6h11v10M14 9h4l3 3v4h-3M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  copy: "M9 9h10v10H9zM5 15H4V4h11v1",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  chart: "M4 20V10m5 10V4m5 16v-7m5 7V8",
  package: "m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 0v20M3 7l9 5 9-5",
  wallet: "M19 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6m15 7h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2",
  menu: "M4 7h16M4 12h16M4 17h16",
  heart: "M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7-1.2c0 4.8-7 13.2-7 13.2Z",
  lock: "M6 11h12v9H6zM9 11V7a3 3 0 1 1 6 0v4",
  sparkle: "m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z",

  // --- casino
  slots: "M4 5h16v14H4zM9 5v14m6-14v14M6.5 12h1m5-1h1m5 1h1",
  cards: "M8 6h9v13H8zM5 9v10h9",
  roulette: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 3v5m0 8v5M3 12h5m8 0h5",
  dice: "M5 5h14v14H5zM9 9h.01M15 15h.01M12 12h.01",
  rocket: "M12 3c3.5 2 5.5 5.5 5.5 9L12 18l-5.5-6c0-3.5 2-7 5.5-9ZM9 17l-2.5 4M15 17l2.5 4M12 11h.01",
  mine: "M12 20a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-14V3m6 4 2-2M6 7 4 5m14 12 2 2M6 17l-2 2",
  trophy: "M8 4h8v5a4 4 0 1 1-8 0V4ZM8 6H5v2a3 3 0 0 0 3 3m8-5h3v2a3 3 0 0 1-3 3M10 17h4v3h-4z",

  // --- shop product art
  lamp: "M8 3h8l3 8H5l3-8Zm4 8v6m-3 4h6",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2v-2Zm16 0a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2v-2Z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  tray: "M3 8h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm2-4h14l2 4H3l2-4Z",
  cup: "M5 5h12v8a5 5 0 0 1-10 0V5Zm12 2h2a2 2 0 1 1 0 5h-2M4 21h14",
  dumbbell: "M6 8v8M4 10v4m14-6v8m2-6v4M8 12h8",
  roller: "M4 8h16v8H4zM8 8v8m4-8v8m4-8v8",
  bottle: "M10 2h4v3l2 3v13H8V8l2-3V2Zm-2 9h8",
  paw: "M12 14c2.8 0 5 1.9 5 4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2c0-2.1 2.2-4 5-4ZM7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4 14a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm16 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  brush: "M6 3h9v8H6zM9 11v6a2 2 0 0 0 4 0v-6M8 6h5",
  mirror: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0 0v2m-3 0h6",
  camera: "M4 8h3l2-3h6l2 3h3v11H4V8Zm8 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  radar: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 12l6-4",
  flame: "M12 22c3.9 0 6-2.6 6-6 0-4-4-5-4-9 0 0-3 1.5-3 5 0 1.5-1 2-1.5 1-.7-1.3-.5-3-.5-3S6 12 6 16c0 3.4 2.1 6 6 6Z",
  blade: "M3 17 17 3l4 4L7 21H3v-4Zm11-11 4 4",
  glasses: "M2 12h4m12 0h4M6 9h4a2 2 0 0 1 2 2 2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-2m-1 0v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z",
  rope: "M6 4v5a6 6 0 0 0 12 0V4M6 20h2m8 0h2M7 4h2M15 4h2",
  wind: "M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h8",
  projector: "M3 8h18v9H3zM7 12.5h.01M14 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM7 17v3m10-3v3",
  vacuum: "M5 20h6v-5a5 5 0 1 1 10 0v5h-3M8 15H5a2 2 0 0 1 0-4h3",
  watch: "M12 18a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm-3-9.5V4h6v4.5m-6 7V20h6v-4.5",
  bed: "M3 18v-7h13a4 4 0 0 1 4 4v3M3 18h18M3 11V7m4 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  bag: "M5 8h14l1 12H4L5 8Zm3 0V6a4 4 0 1 1 8 0v2",
  chip: "M7 7h10v10H7zM4 10h3m-3 4h3m10-4h3m-3 4h3M10 4v3m4-3v3m-4 10v3m4-3v3",
  home: "M4 11 12 4l8 7v9h-6v-5h-4v5H4v-9Z",
};

/**
 * Build an inline SVG icon element.
 * @param {keyof typeof PATHS} name
 * @param {{size?: number, stroke?: number, class?: string, fill?: boolean}} [opts]
 * @returns {SVGElement}
 */
export function icon(name, opts = {}) {
  const { size = 20, stroke = 1.75, fill = false } = opts;
  const path = PATHS[name];
  if (!path) throw new Error(`Unknown icon: ${name}`);

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (opts.class) svg.setAttribute("class", opts.class);

  const node = document.createElementNS(NS, "path");
  node.setAttribute("d", path);
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", String(stroke));
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  if (fill) node.setAttribute("fill", "currentColor");

  svg.append(node);
  return svg;
}

/** Same icon as a markup string, for template literals. */
export function iconMarkup(name, { size = 20, stroke = 1.75 } = {}) {
  const path = PATHS[name];
  if (!path) throw new Error(`Unknown icon: ${name}`);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true" focusable="false"><path d="${path}" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export const hasIcon = (name) => name in PATHS;
export const iconNames = () => Object.keys(PATHS);
