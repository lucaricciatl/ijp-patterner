import type { Drop, Pattern, PatternBlock } from './ptn';
import { fmtMm as fmtNum } from './ptn';

export type Rect = { x: number; y: number; w: number; h: number };

/** Machine raster pitch in millimetres (JetSpacing is given in micrometres). */
export const jetPitch = (p: Pattern): number => p.general.jetSpacing / 1000;

/** Number of jet rows a drop really deposits. A zero/very thin drop still gets one row. */
export function jetRows(drop: Drop, pitch: number): number {
  if (pitch <= 0) return 1;
  if (drop.yHeight <= 0) return 1;
  return Math.max(1, Math.round(drop.yHeight / pitch));
}

/** Physical (quantised) height of a drop once the raster has snapped it to whole rows. */
export function rasterHeight(drop: Drop, pitch: number): number {
  return jetRows(drop, pitch) * pitch;
}

export type BlockInstance = {
  blockIndex: number;
  copyX: number;
  copyY: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Blocks can be repeated MaxXCount × MaxYCount times. XSpacing/YSpacing are the
 * pitch between copy origins (every sample file in the wild uses count = 1, so
 * this never changes an existing pattern).
 */
export function blockInstances(p: Pattern): BlockInstance[] {
  const out: BlockInstance[] = [];
  p.blocks.forEach((b, i) => {
    const nx = Math.max(1, Math.round(b.maxXCount || 1));
    const ny = Math.max(1, Math.round(b.maxYCount || 1));
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        out.push({
          blockIndex: i,
          copyX: ix,
          copyY: iy,
          left: b.left + ix * b.xSpacing,
          top: b.top + iy * b.ySpacing,
          width: b.width,
          height: b.height,
        });
      }
    }
  });
  return out;
}

export const dropRect = (d: Drop): Rect => ({
  x: d.startX,
  y: d.startY,
  w: d.xWidth,
  h: d.yHeight,
});

export function blockBounds(b: PatternBlock): Rect {
  return { x: b.left, y: b.top, w: b.width, h: b.height };
}

/** Ink footprint of every drop, in absolute mm, across all block copies. */
export function inkRects(p: Pattern): Rect[] {
  const out: Rect[] = [];
  for (const inst of blockInstances(p)) {
    for (const d of p.blocks[inst.blockIndex].drops) {
      const r = dropRect(d);
      out.push({ x: inst.left + r.x, y: inst.top + r.y, w: r.w, h: r.h });
    }
  }
  return out;
}

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

export function patternBounds(p: Pattern, includeLeaderBar = true): Bounds {
  const g = p.general;
  let x0 = 0;
  let y0 = 0;
  let x1 = Math.max(g.width, 0.001);
  let y1 = Math.max(g.height, 0.001);

  for (const inst of blockInstances(p)) {
    x0 = Math.min(x0, inst.left);
    y0 = Math.min(y0, inst.top);
    x1 = Math.max(x1, inst.left + inst.width);
    y1 = Math.max(y1, inst.top + inst.height);
  }

  if (includeLeaderBar && g.useLeaderBar) {
    x1 = Math.max(x1, g.leaderBarWidth + g.leaderBarGap);
  }
  return { x0, y0, x1, y1 };
}

/** Print area the machine will actually use: block extent + one jet pitch. */
export function fittedPrintArea(p: Pattern): { width: number; height: number } {
  const pitch = jetPitch(p);
  let right = 0;
  let bottom = 0;
  for (const inst of blockInstances(p)) {
    right = Math.max(right, inst.left + inst.width);
    bottom = Math.max(bottom, inst.top + inst.height);
  }
  return {
    width: Number((right + pitch).toFixed(6)),
    height: Number((bottom + pitch).toFixed(6)),
  };
}

export type Issue = {
  level: 'error' | 'warn' | 'info';
  message: string;
  fix?: 'fitPrintArea';
};

export function validate(p: Pattern): Issue[] {
  const g = p.general;
  const pitch = jetPitch(p);
  const issues: Issue[] = [];

  if (!(pitch > 0)) {
    issues.push({ level: 'error', message: 'Jet spacing must be greater than 0 µm.' });
  }

  if (g.layerCount < 1 || !Number.isInteger(g.layerCount)) {
    issues.push({ level: 'warn', message: `Layer count ${fmtNum(g.layerCount)} is not a whole number ≥ 1.` });
  }

  const fit = fittedPrintArea(p);
  const tol = Math.max(1e-4, pitch * 0.01);
  if (Math.abs(g.width - fit.width) > tol || Math.abs(g.height - fit.height) > tol) {
    issues.push({
      level: 'warn',
      message: `Print area ${fmtNum(g.width)} × ${fmtNum(g.height)} mm does not match blocks + one jet pitch (${fmtNum(
        fit.width,
      )} × ${fmtNum(fit.height)} mm).`,
      fix: 'fitPrintArea',
    });
  }

  if (p.blocks.length === 0) {
    issues.push({ level: 'error', message: 'The pattern has no blocks — nothing would be printed.' });
  }

  p.blocks.forEach((b, bi) => {
    const tag = `Block ${bi + 1}`;
    if (b.width <= 0 || b.height <= 0) {
      issues.push({ level: 'error', message: `${tag} has a zero or negative size.` });
    }
    if (b.left + b.width > g.width + tol || b.top + b.height > g.height + tol) {
      issues.push({ level: 'error', message: `${tag} extends outside the ${fmtNum(g.width)} × ${fmtNum(g.height)} mm print area.` });
    }
    if (b.left < -tol || b.top < -tol) {
      issues.push({ level: 'warn', message: `${tag} starts at a negative coordinate.` });
    }
    if (g.useLeaderBar && b.left < g.leaderBarWidth + g.leaderBarGap - tol) {
      issues.push({
        level: 'warn',
        message: `${tag} overlaps the leader bar (${fmtNum(g.leaderBarWidth)} mm + ${fmtNum(g.leaderBarGap)} mm gap).`,
      });
    } else if (g.useLeaderBar && b.left > g.leaderBarWidth + g.leaderBarGap + tol) {
      issues.push({
        level: 'info',
        message: `${tag} starts ${fmtNum(b.left - g.leaderBarWidth - g.leaderBarGap)} mm right of the leader bar + gap, leaving that strip unprinted.`,
      });
    }
    if (b.drops.length === 0) {
      issues.push({ level: 'warn', message: `${tag} contains no drops.` });
    }

    b.drops.forEach((d, di) => {
      const dt = `Block ${bi + 1} · drop ${di + 1}`;
      if (d.xWidth <= 0) issues.push({ level: 'error', message: `${dt} has a zero or negative width.` });
      if (d.yHeight < 0) issues.push({ level: 'error', message: `${dt} has a negative height.` });
      if (d.startX < -tol || d.startY < -tol) {
        issues.push({ level: 'warn', message: `${dt} starts at a negative coordinate.` });
      }
      if (d.startX + d.xWidth > b.width + tol || d.startY + Math.max(d.yHeight, pitch) > b.height + tol) {
        issues.push({ level: 'warn', message: `${dt} extends outside its block.` });
      }
      if (d.yHeight > 0 && d.yHeight < pitch) {
        issues.push({
          level: 'info',
          message: `${dt} is ${fmtNum(d.yHeight * 1000)} µm tall — thinner than one jet (${fmtNum(g.jetSpacing)} µm), printed as a single row.`,
        });
      }
    });
  });

  // identical duplicates
  const seen = new Map<string, number>();
  p.blocks.forEach((b, bi) => {
    b.drops.forEach((d, di) => {
      const key = `${b.left + d.startX},${b.top + d.startY},${d.xWidth},${d.yHeight}`;
      const prev = seen.get(key);
      if (prev !== undefined) {
        issues.push({ level: 'info', message: `Block ${bi + 1} · drop ${di + 1} duplicates another drop exactly.` });
      } else {
        seen.set(key, di);
      }
    });
  });

  return issues;
}

export type Stats = {
  drops: number;
  blocks: number;
  copies: number;
  layers: number;
  jetPitch: number;
  rows: number;
  inkArea: number;
  coverage: number;
  bbox: Bounds;
};

export function stats(p: Pattern): Stats {
  const pitch = jetPitch(p);
  const copies = blockInstances(p).length;
  let drops = 0;
  let rows = 0;
  let inkArea = 0;
  for (const b of p.blocks) {
    for (const d of b.drops) {
      drops++;
      rows += jetRows(d, pitch);
      inkArea += Math.max(0, d.xWidth) * Math.max(0, d.yHeight || pitch);
    }
  }
  drops *= copies;
  rows *= copies;
  inkArea *= copies;
  const bb = patternBounds(p);
  const area = Math.max(1e-9, (bb.x1 - bb.x0) * (bb.y1 - bb.y0));
  return {
    drops,
    blocks: p.blocks.length,
    copies,
    layers: Math.max(1, Math.round(p.general.layerCount || 1)),
    jetPitch: pitch,
    rows,
    inkArea,
    coverage: inkArea / area,
    bbox: bb,
  };
}
