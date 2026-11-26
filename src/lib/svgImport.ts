import type { Drop } from './ptn';

export type SvgImportOptions = {
  /** millimetres per SVG user unit */
  scale: number;
  /** if set, rescale so the drawing is exactly this wide (mm) */
  fitWidth: number | null;
  /** stroke thickness when the element has no stroke-width (mm) */
  strokeMm: number;
  maxDrops: number;
};

export const defaultImportOptions: SvgImportOptions = {
  scale: 1,
  fitWidth: null,
  strokeMm: 0.05,
  maxDrops: 2000,
};

export type SvgImportResult = {
  drops: Drop[];
  width: number;
  height: number;
  shapes: number;
  warnings: string[];
  truncated: boolean;
};

const r6 = (v: number) => Number(v.toFixed(6));

type Pt = { x: number; y: number };

/**
 * Parse an SVG and turn its geometry into axis-aligned deposit rectangles.
 *
 * - axis-aligned <rect> → one drop
 * - lines, polylines, polygons, paths, circles → thin boxes along the path,
 *   inflated by the stroke width (paths are sampled with the browser's own
 *   geometry API, so curves and arcs are handled)
 * - filled non-rect shapes → their bounding box, with a warning
 */
export function importSvg(svgText: string, opts: SvgImportOptions): SvgImportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('That file is not valid SVG.');

  const root = doc.documentElement as unknown as SVGSVGElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('No <svg> element found.');

  // render off-screen so getCTM / getTotalLength / getPointAtLength work
  const host = document.createElement('div');
  host.setAttribute(
    'style',
    'position:fixed;left:-20000px;top:0;width:4000px;height:4000px;overflow:hidden;opacity:0;pointer-events:none',
  );
  const mounted = document.importNode(root, true) as SVGSVGElement;
  host.appendChild(mounted);
  document.body.appendChild(host);

  let shapes = 0;
  const segments: Array<{ a: Pt; b: Pt; t: number }> = [];
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];

  const rootInv = mounted.getScreenCTM()?.inverse() ?? null;
  const toRoot = (el: SVGGraphicsElement) => {
    const m = el.getScreenCTM();
    if (!m || !rootInv) return null;
    return rootInv.multiply(m);
  };

  // 0.1 mm in user units: long straight lines are chopped so a diagonal becomes a
  // fine staircase of small deposits instead of one huge over-filled bounding box
  const subStep = 0.1 / Math.max(1e-9, opts.scale);

  const pushSegments = (pts: Pt[], t: number) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      const n = Math.min(400, Math.max(1, Math.ceil(len / subStep)));
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        segments.push({
          a: { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
          b: { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 },
          t,
        });
      }
      if (segments.length > 40000) return;
    }
  };

  const strokeWidthOf = (el: Element): number => {
    const raw = el.getAttribute('stroke-width') || el.getAttribute('stroke') === 'none' ? el.getAttribute('stroke-width') : null;
    const v = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(v) && v > 0) return v;
    return opts.strokeMm / Math.max(1e-9, opts.scale);
  };

  const isFilled = (el: Element) => {
    const fill = (el.getAttribute('fill') || '').trim().toLowerCase();
    return fill !== '' && fill !== 'none' && fill !== 'transparent';
  };

  try {
    const all = mounted.querySelectorAll<SVGGraphicsElement>(
      'rect, circle, ellipse, line, polyline, polygon, path',
    );

    for (const el of Array.from(all)) {
      const ctm = toRoot(el);
      if (!ctm) continue;
      const tag = el.tagName.toLowerCase();
      const num = (name: string, fallback = 0) => {
        const v = Number.parseFloat(el.getAttribute(name) || '');
        return Number.isFinite(v) ? v : fallback;
      };
      const mapPt = (p: Pt): Pt => ({ x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f });
      const t = strokeWidthOf(el) * Math.hypot(ctm.a, ctm.b) || opts.strokeMm / Math.max(1e-9, opts.scale);

      if (tag === 'rect') {
        const x = num('x');
        const y = num('y');
        const w = num('width');
        const h = num('height');
        if (w <= 0 || h <= 0) continue;
        const quad = [mapPt({ x, y }), mapPt({ x: x + w, y }), mapPt({ x: x + w, y: y + h }), mapPt({ x, y: y + h })];
        const aligned =
          Math.abs(quad[0].y - quad[1].y) < 1e-6 &&
          Math.abs(quad[1].x - quad[2].x) < 1e-6 &&
          Math.abs(quad[2].y - quad[3].y) < 1e-6 &&
          Math.abs(quad[3].x - quad[0].x) < 1e-6;
        shapes++;
        if (aligned && isFilled(el)) {
          // a filled rectangle is one deposit
          rects.push({
            x: Math.min(quad[0].x, quad[2].x),
            y: Math.min(quad[0].y, quad[2].y),
            w: Math.abs(quad[2].x - quad[0].x),
            h: Math.abs(quad[2].y - quad[0].y),
          });
        } else if (aligned) {
          // fill="none": the printer can only lay the outline, so deposit its four edges
          pushSegments([...quad, quad[0]], t);
        } else {
          warnings.push('A rotated rectangle was approximated by its bounding box.');
          const xs = quad.map((p) => p.x);
          const ys = quad.map((p) => p.y);
          rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
        }
        continue;
      }

      if (tag === 'circle' || tag === 'ellipse') {
        const cx = num('cx');
        const cy = num('cy');
        const rx = tag === 'circle' ? num('r') : num('rx');
        const ry = tag === 'circle' ? num('r') : num('ry');
        if (rx <= 0 || ry <= 0) continue;
        shapes++;
        if (isFilled(el)) {
          const pts = Array.from({ length: 72 }, (_, i) => {
            const a = (i / 72) * Math.PI * 2;
            return mapPt({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
          });
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
          warnings.push('A filled circle/ellipse was converted to its bounding box.');
        } else {
          const n = 96;
          pushSegments(
            Array.from({ length: n + 1 }, (_, i) => {
              const a = (i / n) * Math.PI * 2;
              return mapPt({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
            }),
            t,
          );
        }
        continue;
      }

      if (tag === 'line') {
        shapes++;
        pushSegments([mapPt({ x: num('x1'), y: num('y1') }), mapPt({ x: num('x2'), y: num('y2') })], Math.max(t, 1e-6));
        continue;
      }

      if (tag === 'polyline' || tag === 'polygon') {
        const nums = (el.getAttribute('points') || '')
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n));
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push(mapPt({ x: nums[i], y: nums[i + 1] }));
        if (tag === 'polygon' && pts.length > 1) pts.push(pts[0]);
        if (pts.length < 2) continue;
        shapes++;
        pushSegments(pts, t);
        continue;
      }

      if (tag === 'path') {
        const path = el as unknown as SVGPathElement;
        shapes++;
        if (isFilled(el)) {
          const bb = path.getBBox();
          const p1 = mapPt({ x: bb.x, y: bb.y });
          const p2 = mapPt({ x: bb.x + bb.width, y: bb.y + bb.height });
          rects.push({ x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) });
          warnings.push('A filled path was converted to its bounding box.');
          continue;
        }
        const len = path.getTotalLength();
        if (!Number.isFinite(len) || len <= 0) continue;
        // one sample every 0.05 mm of the final drawing
        const n = Math.min(3000, Math.max(8, Math.round((len * opts.scale) / 0.05)));
        const pts: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const p = path.getPointAtLength((i / n) * len);
          pts.push(mapPt({ x: p.x, y: p.y }));
        }
        pushSegments(pts, t);
      }
    }
  } finally {
    host.remove();
  }

  // ---- to millimetres, then optional fit-to-width -------------------------
  const raw: Array<{ x: number; y: number; w: number; h: number; mergeable: 'h' | 'v' | null }> = [];
  for (const r of rects) raw.push({ x: r.x * opts.scale, y: r.y * opts.scale, w: r.w * opts.scale, h: r.h * opts.scale, mergeable: null });
  for (const s of segments) {
    const t = Math.max(s.t, opts.strokeMm / Math.max(1e-9, opts.scale)) * opts.scale;
    const x1 = s.a.x * opts.scale;
    const y1 = s.a.y * opts.scale;
    const x2 = s.b.x * opts.scale;
    const y2 = s.b.y * opts.scale;
    raw.push({
      x: Math.min(x1, x2) - t / 2,
      y: Math.min(y1, y2) - t / 2,
      w: Math.abs(x2 - x1) + t,
      h: Math.abs(y2 - y1) + t,
      // straight runs may be merged back; diagonals must stay stepped
      mergeable:
        Math.abs(y2 - y1) <= t * 0.51 ? 'h' : Math.abs(x2 - x1) <= t * 0.51 ? 'v' : null,
    });
  }

  if (raw.length === 0) throw new Error('No printable shapes found in that SVG.');

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of raw) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  let k = 1;
  if (opts.fitWidth && opts.fitWidth > 0) {
    k = opts.fitWidth / Math.max(1e-9, maxX - minX);
  }

  // merge collinear neighbours so a straight CAD line becomes one drop
  const merged: Array<{ x: number; y: number; w: number; h: number }> = [];
  const rowKey = new Map<string, { x: number; y: number; w: number; h: number }>();
  const colKey = new Map<string, { x: number; y: number; w: number; h: number }>();

  for (const r of raw) {
    const m = {
      x: r6((r.x - minX) * k),
      y: r6((r.y - minY) * k),
      w: r6(r.w * k),
      h: r6(r.h * k),
    };
    if (r.mergeable === 'h') {
      const key = `${m.y}:${m.h}`;
      const prev = rowKey.get(key);
      if (prev && m.x <= prev.x + prev.w + 1e-6 && m.x + m.w >= prev.x - 1e-6) {
        prev.w = r6(Math.max(prev.x + prev.w, m.x + m.w) - prev.x);
        continue;
      }
      rowKey.set(key, m);
      merged.push(m);
      continue;
    }
    if (r.mergeable === 'v') {
      const key = `${m.x}:${m.w}`;
      const prev = colKey.get(key);
      if (prev && m.y <= prev.y + prev.h + 1e-6 && m.y + m.h >= prev.y - 1e-6) {
        prev.h = r6(Math.max(prev.y + prev.h, m.y + m.h) - prev.y);
        continue;
      }
      colKey.set(key, m);
      merged.push(m);
      continue;
    }
    merged.push(m);
  }

  merged.sort((a, b) => a.y - b.y || a.x - b.x);
  const truncated = merged.length > opts.maxDrops;
  const kept = truncated ? merged.slice(0, opts.maxDrops) : merged;
  if (truncated) warnings.push(`Kept the first ${opts.maxDrops} shapes — the drawing is too detailed for one pattern.`);
  if (shapes > 400) warnings.push(`${shapes} SVG shapes were expanded into ${kept.length} deposit rectangles.`);

  const drops: Drop[] = kept.map((r) => ({
    startX: Math.max(0, r.x),
    startY: Math.max(0, r.y),
    xWidth: Math.max(0, r.w),
    yHeight: Math.max(0, r.h),
    extra: [],
  }));

  return {
    drops,
    width: r6((maxX - minX) * k),
    height: r6((maxY - minY) * k),
    shapes,
    warnings,
    truncated,
  };
}
