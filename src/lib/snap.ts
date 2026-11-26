import type { Pattern } from './ptn';
import { blockInstances } from './geometry';

export type Guides = { x: number[]; y: number[] };

export type SnapTargets = { x: number[]; y: number[] };

/**
 * Everything a dragged edge/centre can stick to: the print-area border, the
 * block being edited, and every other drop's edges and centres.
 */
export function snapTargets(p: Pattern, bi: number, skipDi: number | number[]): SnapTargets {
  const skip = new Set(Array.isArray(skipDi) ? skipDi : [skipDi]);
  const xs = new Set<number>([0, p.general.width, p.general.left]);
  const ys = new Set<number>([0, p.general.height, p.general.top]);
  const blk = p.blocks[bi];
  if (blk) {
    xs.add(blk.left);
    xs.add(blk.left + blk.width);
    ys.add(blk.top);
    ys.add(blk.top + blk.height);
    for (const inst of blockInstances(p)) {
      if (inst.blockIndex !== bi) continue;
      for (let di = 0; di < blk.drops.length; di++) {
        if (skip.has(di)) continue;
        const d = blk.drops[di];
        const l = inst.left + d.startX;
        const t = inst.top + d.startY;
        xs.add(l);
        xs.add(l + d.xWidth / 2);
        xs.add(l + d.xWidth);
        ys.add(t);
        ys.add(t + d.yHeight / 2);
        ys.add(t + d.yHeight);
      }
    }
  }
  return { x: [...xs], y: [...ys] };
}

export type SnapOne = { value: number; guide: number | null };

/** Prefer a real feature within tolerance, otherwise fall back to the step grid. */
export function snapValue(v: number, targets: number[], step: number, tol: number): SnapOne {
  let best: { d: number; t: number } | null = null;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d <= tol && (!best || d < best.d)) best = { d, t };
  }
  if (best) return { value: best.t, guide: best.t };
  if (step > 0) {
    const g = Math.round(v / step) * step;
    return { value: Number(g.toFixed(9)), guide: null };
  }
  return { value: v, guide: null };
}

export type Box = { left: number; top: number; right: number; bottom: number };

/**
 * Snap a moving box: try left/centre/right against x targets, top/middle/
 * bottom against y targets, translating the whole box by the smallest shift.
 */
export function snapBox(box: Box, targets: SnapTargets, step: number, tol: number): { box: Box; guides: Guides } {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;

  let bestX: { d: number; shift: number; guide: number } | null = null;
  for (const t of targets.x) {
    for (const edge of [box.left, cx, box.right]) {
      const shift = t - edge;
      const d = Math.abs(shift);
      if (d <= tol && (!bestX || d < bestX.d)) bestX = { d, shift, guide: t };
    }
  }

  let bestY: { d: number; shift: number; guide: number } | null = null;
  for (const t of targets.y) {
    for (const edge of [box.top, cy, box.bottom]) {
      const shift = t - edge;
      const d = Math.abs(shift);
      if (d <= tol && (!bestY || d < bestY.d)) bestY = { d, shift, guide: t };
    }
  }

  let shiftX = bestX ? bestX.shift : 0;
  let shiftY = bestY ? bestY.shift : 0;
  if (!bestX && step > 0) shiftX = Math.round(box.left / step) * step - box.left;
  if (!bestY && step > 0) shiftY = Math.round(box.top / step) * step - box.top;

  const out: Box = {
    left: Number((box.left + shiftX).toFixed(9)),
    top: Number((box.top + shiftY).toFixed(9)),
    right: Number((box.right + shiftX).toFixed(9)),
    bottom: Number((box.bottom + shiftY).toFixed(9)),
  };
  return {
    box: out,
    guides: {
      x: bestX ? [bestX.guide] : [],
      y: bestY ? [bestY.guide] : [],
    },
  };
}

/** Snap a single moving edge (resize) on one axis. */
export function snapEdge(v: number, targets: number[], step: number, tol: number): SnapOne {
  return snapValue(v, targets, step, tol);
}
