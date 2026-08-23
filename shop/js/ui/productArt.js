/**
 * Deterministic product illustrations.
 *
 * Real stores use supplier photography. This project has no image hosting and
 * must render identically offline, so each product gets a generated SVG built
 * from its `art` descriptor: a two-stop gradient in the product's hue, a soft
 * pattern, and the category glyph. Same product ⇒ same picture, every time.
 */

import { iconMarkup } from "../../../assets/js/icons.js";

/** Cheap deterministic hash → used for the decorative blob positions. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * @param {{id:string, art:{hue:number, accentHue:number, glyph:string}}} product
 * @param {{size?:number, variantIndex?:number, detail?:boolean}} [opts]
 * @returns {string} SVG markup
 */
export function productArt(product, { variantIndex = 0, detail = false } = {}) {
  const { hue, accentHue, glyph } = product.art;
  // Each gallery angle shifts the hue slightly so thumbnails read as different
  // shots of the same product rather than four identical tiles.
  const shift = variantIndex * 14;
  const h1 = (hue + shift) % 360;
  const h2 = (accentHue + shift) % 360;

  const seed = hash(product.id + variantIndex);
  const seed2 = hash(product.id + "b" + variantIndex);
  const gid = `g-${product.id.replace(/[^a-z0-9]/gi, "")}-${variantIndex}`;

  const blobX = 20 + seed * 60;
  const blobY = 18 + seed2 * 50;
  const blobR = 26 + seed * 22;

  const glyphSize = detail ? 46 : 34;
  const glyphOffset = 50 - glyphSize / 2;

  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${escapeAttr(product.title)}">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${h1} 68% 62%)"/>
      <stop offset="100%" stop-color="hsl(${h2} 62% 44%)"/>
    </linearGradient>
    <radialGradient id="${gid}-b" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="hsl(${h1} 90% 82%)" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="hsl(${h1} 90% 82%)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" fill="url(#${gid})"/>
  <circle cx="${blobX.toFixed(1)}" cy="${blobY.toFixed(1)}" r="${blobR.toFixed(1)}" fill="url(#${gid}-b)"/>
  <circle cx="${(100 - blobX).toFixed(1)}" cy="${(100 - blobY * 0.6).toFixed(1)}" r="${(blobR * 0.7).toFixed(1)}" fill="hsl(${h2} 80% 30%)" opacity="0.16"/>
  <g transform="translate(${glyphOffset} ${glyphOffset}) scale(${(glyphSize / 24).toFixed(3)})" opacity="0.94" color="rgba(255,255,255,0.95)">
    ${iconMarkup(glyph, { size: 24, stroke: 1.5 })}
  </g>
</svg>`;
}

/** Insert generated art into a container element. */
export function renderArt(container, product, opts) {
  container.innerHTML = productArt(product, opts);
  return container;
}

/** Four "angles" of the same product, for the detail gallery. */
export const galleryViews = (product, count = 4) =>
  Array.from({ length: count }, (_, i) => productArt(product, { variantIndex: i, detail: true }));

const escapeAttr = (str) =>
  String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
