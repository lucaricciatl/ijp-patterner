import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Drop, Pattern } from '../lib/ptn';
import { fmtMm as fmtNum } from '../lib/ptn';
import { blockInstances, jetPitch, jetRows, type BlockInstance } from '../lib/geometry';
import { snapBox, snapTargets, snapValue, type Guides } from '../lib/snap';
import { Icon } from './ui';

export type View = { x: number; y: number; scale: number };
export type DropRef = { bi: number; di: number };

export type Selection =
  | { kind: 'general' }
  | { kind: 'block'; bi: number }
  | { kind: 'drop'; bi: number; di: number }
  | { kind: 'drops'; items: DropRef[] }
  | null;

/** Every selected drop, whether the selection is single or multiple. */
export function selectionRefs(sel: Selection): DropRef[] {
  if (!sel) return [];
  if (sel.kind === 'drop') return [{ bi: sel.bi, di: sel.di }];
  if (sel.kind === 'drops') return sel.items;
  return [];
}

export function isRefSelected(sel: Selection, bi: number, di: number): boolean {
  return selectionRefs(sel).some((r) => r.bi === bi && r.di === di);
}

export const RULER = 26;
const PX_PER_MM_100 = 3.7795275591; // 96 dpi
const SNAP_PX = 7;
const MONO = "'SF Mono', ui-monospace, Menlo, monospace";
const NICE = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

export function niceStep(scale: number, minPx: number): number {
  for (const s of NICE) if (s * scale >= minPx) return s;
  return NICE[NICE.length - 1];
}

function decimalsFor(step: number): number {
  if (step >= 1) return step % 1 === 0 ? 0 : 1;
  if (step >= 0.1) return step === 0.5 ? 1 : 2;
  if (step >= 0.01) return 3;
  return 4;
}

export function zoomLabel(scale: number): string {
  const pct = (scale / PX_PER_MM_100) * 100;
  if (pct >= 1000) return `${Math.round(pct / 100) * 100}%`;
  if (pct >= 100) return `${Math.round(pct)}%`;
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

type Props = {
  pattern: Pattern;
  selection: Selection;
  onSelect: (s: Selection) => void;
  view: View;
  setView: (v: View) => void;
  mode: 'design' | 'raster';
  showGrid: boolean;
  snap: boolean;
  onSize: (s: { w: number; h: number }) => void;
  beginEdit: () => void;
  editDrop: (bi: number, di: number, patch: Partial<Drop>, live: boolean) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onFit: () => void;
  snapStep: number;
  snapFeatures: boolean;
  onCursorMove: (mm: { x: number; y: number } | null) => void;
  createDrop: (bi: number, drop: Drop) => void;
  moveDrops: (refs: DropRef[], values: Array<{ startX: number; startY: number }>, live: boolean) => void;
};

export default function Canvas({
  pattern,
  selection,
  onSelect,
  view,
  setView,
  mode,
  showGrid,
  snap,
  onSize,
  beginEdit,
  editDrop,
  svgRef,
  onFit,
  snapStep,
  snapFeatures,
  onCursorMove,
  createDrop,
  moveDrops,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 640 });
  const [panning, setPanning] = useState(false);
  const [hover, setHover] = useState<{ bi: number; di: number; px: number; py: number } | null>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);

  // The observer must survive re-renders: re-subscribing fires an immediate
  // observation, and if that reported a "new" size the parent re-fit the view,
  // which made every zoom and pan look like it did nothing.
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const lastSize = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const apply = (width: number, height: number) => {
      const next = { w: Math.max(320, Math.round(width)), h: Math.max(240, Math.round(height)) };
      if (next.w === lastSize.current.w && next.h === lastSize.current.h) return;
      lastSize.current = next;
      setSize(next);
      onSizeRef.current(next);
    };

    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      apply(r.width, r.height);
    });
    ro.observe(el);
    const box = el.getBoundingClientRect();
    apply(box.width, box.height);
    return () => ro.disconnect();
  }, []);

  const plotW = size.w - RULER;
  const plotH = size.h - RULER;

  const toMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: view.x + (clientX - rect.left - RULER) / view.scale,
        y: view.y + (clientY - rect.top - RULER) / view.scale,
      };
    },
    [view, svgRef],
  );

  const pitch = jetPitch(pattern);

  const clampScale = (s: number) => Math.min(30000, Math.max(0.03, s));

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const next = clampScale(view.scale * factor);
      const mm = toMm(cx, cy);
      setView({
        scale: next,
        x: mm.x - (cx - (svgRef.current?.getBoundingClientRect().left ?? 0) - RULER) / next,
        y: mm.y - (cy - (svgRef.current?.getBoundingClientRect().top ?? 0) - RULER) / next,
      });
    },
    [view, toMm, setView, svgRef],
  );

  // native wheel listener: React's onWheel is passive
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      zoomAt(factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  type Drag =
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | {
        kind: 'edit';
        op: 'move' | 'resize';
        handle: string;
        refs: DropRef[];
        bi: number;
        di: number;
        mm: { x: number; y: number };
        orig: Drop;
        origs: Drop[];
        box: { left: number; top: number; right: number; bottom: number };
        pushed: boolean;
      }
    | { kind: 'shift'; anchor: { x: number; y: number }; moved: boolean; toggle: DropRef | null }
    | { kind: 'create'; bi: number; anchor: { x: number; y: number }; armed: boolean }
    | null;

  const drag = useRef<Drag>(null);
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const gridStep = snapStep && snapStep > 0 ? snapStep : pitch;
  const tol = SNAP_PX / view.scale;

  const spaceRef = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        spaceRef.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const capture = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const toggleRef = (ref: DropRef) => {
    const cur = selectionRefs(selection);
    const has = cur.some((r) => r.bi === ref.bi && r.di === ref.di);
    const next = has ? cur.filter((r) => !(r.bi === ref.bi && r.di === ref.di)) : [...cur, ref];
    if (next.length === 0) onSelect(null);
    else if (next.length === 1) onSelect({ kind: 'drop', bi: next[0].bi, di: next[0].di });
    else onSelect({ kind: 'drops', items: next });
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.zoom-box')) return;

    const dropEl = target.closest('[data-drop]') as HTMLElement | null;
    const handleEl = target.closest('[data-handle]') as HTMLElement | null;
    const mm = toMm(e.clientX, e.clientY);

    // shift = selection gesture: drag for a marquee, plain click toggles one drop
    if (e.shiftKey) {
      drag.current = {
        kind: 'shift',
        anchor: mm,
        moved: false,
        toggle: dropEl && !handleEl ? { bi: Number(dropEl.dataset.bi), di: Number(dropEl.dataset.di) } : null,
      };
      capture(e);
      return;
    }

    // middle / right button or space-held pans
    if (e.button === 1 || e.button === 2 || spaceRef.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      setPanning(true);
      capture(e);
      return;
    }

    // a resize handle sits outside the drop group, so it must be resolved first
    if (handleEl) {
      const bi = Number(handleEl.dataset.bi);
      const di = Number(handleEl.dataset.di);
      const orig = pattern.blocks[bi]?.drops[di];
      if (orig) {
        onSelect({ kind: 'drop', bi, di });
        drag.current = {
          kind: 'edit',
          op: 'resize',
          handle: handleEl.dataset.handle ?? 'se',
          refs: [{ bi, di }],
          bi,
          di,
          mm,
          orig: { ...orig },
          origs: [{ ...orig }],
          box: {
            left: pattern.blocks[bi].left + orig.startX,
            top: pattern.blocks[bi].top + orig.startY,
            right: pattern.blocks[bi].left + orig.startX + orig.xWidth,
            bottom: pattern.blocks[bi].top + orig.startY + orig.yHeight,
          },
          pushed: false,
        };
        capture(e);
        return;
      }
    }

    if (dropEl) {
      const bi = Number(dropEl.dataset.bi);
      const di = Number(dropEl.dataset.di);
      const orig = pattern.blocks[bi]?.drops[di];
      if (!orig) return;

      const cur = selectionRefs(selection);
      const inGroup = cur.length > 1 && cur.some((r) => r.bi === bi && r.di === di);
      const refs: DropRef[] = inGroup ? cur : [{ bi, di }];
      if (!inGroup) onSelect({ kind: 'drop', bi, di });

      const origs = refs.map((r) => ({ ...pattern.blocks[r.bi].drops[r.di] }));
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      refs.forEach((r, k) => {
        const b = pattern.blocks[r.bi];
        const d = origs[k];
        const x = b.left + d.startX;
        const y = b.top + d.startY;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + d.xWidth);
        bottom = Math.max(bottom, y + d.yHeight);
      });

      drag.current = {
        kind: 'edit',
        op: 'move',
        handle: 'se',
        refs,
        bi,
        di,
        mm,
        orig: { ...orig },
        origs,
        box: { left, top, right, bottom },
        pushed: false,
      };
      capture(e);
      return;
    }

    // empty canvas: drag inside a block draws a new drop, elsewhere pans
    const inst = blockInstances(pattern).find(
      (i) =>
        i.copyX === 0 && i.copyY === 0 && mm.x >= i.left && mm.x <= i.left + i.width && mm.y >= i.top && mm.y <= i.top + i.height,
    );
    if (inst) {
      const anchor = {
        x: Math.min(inst.left + inst.width, Math.max(inst.left, snapValue(mm.x, [], gridStep, 0).value)),
        y: Math.min(inst.top + inst.height, Math.max(inst.top, snapValue(mm.y, [], gridStep, 0).value)),
      };
      onSelect({ kind: 'block', bi: inst.blockIndex });
      drag.current = { kind: 'create', bi: inst.blockIndex, anchor, armed: false };
      setPreview({ x: anchor.x, y: anchor.y, w: 0, h: 0 });
      capture(e);
      return;
    }

    onSelect(null);
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
    capture(e);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const mm = toMm(e.clientX, e.clientY);

    if (!d) {
      if (cursorRef.current) cursorRef.current.textContent = `${mm.x.toFixed(3)}, ${mm.y.toFixed(3)}`;
      onCursorMove(mm);
      return;
    }

    if (d.kind === 'pan') {
      setView({
        ...view,
        x: d.vx - (e.clientX - d.sx) / view.scale,
        y: d.vy - (e.clientY - d.sy) / view.scale,
      });
      return;
    }

    const free = e.altKey;
    const gridOn = snap && !free;
    const featOn = snapFeatures && !free;
    const stepFor = gridOn ? gridStep : 0;

    if (d.kind === 'shift') {
      const movedPx = Math.hypot((mm.x - d.anchor.x) * view.scale, (mm.y - d.anchor.y) * view.scale);
      if (!d.moved && movedPx < 3) return;
      d.moved = true;
      const g = pattern.general;
      const x1 = Math.max(0, Math.min(d.anchor.x, mm.x));
      const x2 = Math.min(g.width, Math.max(d.anchor.x, mm.x));
      const y1 = Math.max(0, Math.min(d.anchor.y, mm.y));
      const y2 = Math.min(g.height, Math.max(d.anchor.y, mm.y));
      setPreview({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      return;
    }

    if (d.kind === 'create') {
      const blk = pattern.blocks[d.bi];
      if (!d.armed) {
        const moved = Math.hypot((mm.x - d.anchor.x) * view.scale, (mm.y - d.anchor.y) * view.scale);
        if (moved < 4) return;
        d.armed = true;
      }
      let x1 = d.anchor.x;
      let y1 = d.anchor.y;
      let x2 = mm.x;
      let y2 = mm.y;
      if (!free) {
        const tg = featOn ? snapTargets(pattern, d.bi, -1) : { x: [] as number[], y: [] as number[] };
        const sx = snapValue(x2, tg.x, stepFor, tol);
        const sy = snapValue(y2, tg.y, stepFor, tol);
        x2 = sx.value;
        y2 = sy.value;
        x1 = Math.max(0, Math.min(x1, blk.width));
        y1 = Math.max(0, Math.min(y1, blk.height));
        setGuides({ x: sx.guide != null ? [sx.guide] : [], y: sy.guide != null ? [sy.guide] : [] });
      } else {
        setGuides({ x: [], y: [] });
      }
      const left = Math.max(blk.left, Math.min(x1, x2));
      const top = Math.max(blk.top, Math.min(y1, y2));
      const right = Math.min(blk.left + blk.width, Math.max(x1, x2));
      const bottom = Math.min(blk.top + blk.height, Math.max(y1, y2));
      setPreview({ x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) });
      return;
    }

    const dx = mm.x - d.mm.x;
    const dy = mm.y - d.mm.y;
    if (!d.pushed && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    if (!d.pushed) {
      beginEdit();
      d.pushed = true;
    }

    const o = d.orig;

    if (d.op === 'move') {
      const base = d.box;
      let box = {
        left: base.left + dx,
        top: base.top + dy,
        right: base.right + dx,
        bottom: base.bottom + dy,
      };
      if (!free) {
        const skip = d.refs.map((r) => r.di);
        const res = snapBox(
          box,
          featOn ? snapTargets(pattern, d.refs[0].bi, skip) : { x: [], y: [] },
          stepFor,
          tol,
        );
        box = res.box;
        setGuides(res.guides);
      } else {
        setGuides({ x: [], y: [] });
      }
      const mx = box.left - base.left;
      const my = box.top - base.top;
      moveDrops(
        d.refs,
        d.origs.map((od) => ({
          startX: Number(Math.max(0, od.startX + mx).toFixed(6)),
          startY: Number(Math.max(0, od.startY + my).toFixed(6)),
        })),
        true,
      );
      return;
    }

    const h = d.handle;
    let left = o.startX;
    let top = o.startY;
    let right = o.startX + o.xWidth;
    let bottom = o.startY + o.yHeight;
    const tg = featOn ? snapTargets(pattern, d.bi, d.di) : { x: [] as number[], y: [] as number[] };
    const gx: number[] = [];
    const gy: number[] = [];

    if (h.includes('w')) {
      const r = snapValue(o.startX + dx, tg.x, stepFor, tol);
      left = Math.min(r.value, right);
      if (r.guide != null) gx.push(r.guide);
    }
    if (h.includes('e')) {
      const r = snapValue(right + dx, tg.x, stepFor, tol);
      right = Math.max(r.value, left);
      if (r.guide != null) gx.push(r.guide);
    }
    if (h.includes('n')) {
      const r = snapValue(o.startY + dy, tg.y, stepFor, tol);
      top = Math.min(r.value, bottom);
      if (r.guide != null) gy.push(r.guide);
    }
    if (h.includes('s')) {
      const r = snapValue(bottom + dy, tg.y, stepFor, tol);
      bottom = Math.max(r.value, top);
      if (r.guide != null) gy.push(r.guide);
    }
    setGuides({ x: gx, y: gy });

    const r6 = (v: number) => Number(v.toFixed(6));
    const x0 = Math.max(0, Math.min(left, right));
    const y0 = Math.max(0, Math.min(top, bottom));
    editDrop(
      d.bi,
      d.di,
      {
        startX: r6(x0),
        startY: r6(y0),
        xWidth: r6(Math.abs(right - left)),
        yHeight: r6(Math.abs(bottom - top)),
      },
      true,
    );
  };

  const finishDrag = () => {
    const d = drag.current;

    if (d?.kind === 'shift') {
      if (!d.moved) {
        if (d.toggle) toggleRef(d.toggle);
        drag.current = null;
        setPreview(null);
        setGuides({ x: [], y: [] });
        return;
      }
      const big = preview && (preview.w * view.scale > 3 || preview.h * view.scale > 3);
      if (big && preview) {
        const hits: DropRef[] = [];
        for (const inst of blockInstances(pattern)) {
          if (inst.copyX !== 0 || inst.copyY !== 0) continue;
          pattern.blocks[inst.blockIndex].drops.forEach((dr, di) => {
            const x = inst.left + dr.startX;
            const y = inst.top + dr.startY;
            const w = dr.xWidth;
            const h = Math.max(dr.yHeight, pitch);
            if (x < preview.x + preview.w && x + w > preview.x && y < preview.y + preview.h && y + h > preview.y) {
              hits.push({ bi: inst.blockIndex, di });
            }
          });
        }
        if (hits.length === 1) onSelect({ kind: 'drop', bi: hits[0].bi, di: hits[0].di });
        else if (hits.length > 1) onSelect({ kind: 'drops', items: hits });
      }
      drag.current = null;
      setPanning(false);
      setPreview(null);
      setGuides({ x: [], y: [] });
      return;
    }
    if (d?.kind === 'create' && preview) {
      const big = preview.w * view.scale > 4 || preview.h * view.scale > 4;
      if (big && preview.w > 0 && preview.h > 0) {
        const blk = pattern.blocks[d.bi];
        const drop: Drop = {
          startX: Number(Math.max(0, preview.x - blk.left).toFixed(6)),
          startY: Number(Math.max(0, preview.y - blk.top).toFixed(6)),
          xWidth: Number(preview.w.toFixed(6)),
          yHeight: Number(preview.h.toFixed(6)),
          extra: [],
        };
        beginEdit();
        createDrop(d.bi, drop);
        onSelect({ kind: 'drop', bi: d.bi, di: blk.drops.length });
      }
    }
    drag.current = null;
    setPanning(false);
    setPreview(null);
    setGuides({ x: [], y: [] });
  };

  const cancelDrag = () => {
    drag.current = null;
    setPanning(false);
    setPreview(null);
    setGuides({ x: [], y: [] });
  };

  /* --------------------------------------------------------- rendering --- */

  const instances = useMemo(() => blockInstances(pattern), [pattern]);
  const g = pattern.general;
  const showStripes = mode === 'raster' && pitch * view.scale >= 2.2;

  const mmX = (mm: number) => RULER + (mm - view.x) * view.scale;
  const mmY = (mm: number) => RULER + (mm - view.y) * view.scale;

  const step = niceStep(view.scale, 66);
  const minor = step / 5;
  const dec = decimalsFor(step);

  const gridLines: React.ReactNode[] = [];
  if (showGrid) {
    const x0 = Math.floor(view.x / minor) * minor;
    const y0 = Math.floor(view.y / minor) * minor;
    const nx = Math.ceil(plotW / (minor * view.scale)) + 2;
    const ny = Math.ceil(plotH / (minor * view.scale)) + 2;
    if (nx < 700 && ny < 700) {
      for (let i = 0; i < nx; i++) {
        const x = mmX(x0 + i * minor);
        const majorTick = Math.abs(((x0 + i * minor) / step) % 1) < 1e-9;
        gridLines.push(
          <line key={`gx${i}`} x1={x} y1={RULER} x2={x} y2={size.h}
            stroke={majorTick ? '#1b2833' : '#121b23'} strokeWidth={1} />,
        );
      }
      for (let j = 0; j < ny; j++) {
        const y = mmY(y0 + j * minor);
        const majorTick = Math.abs(((y0 + j * minor) / step) % 1) < 1e-9;
        gridLines.push(
          <line key={`gy${j}`} x1={RULER} y1={y} x2={size.w} y2={y}
            stroke={majorTick ? '#1b2833' : '#121b23'} strokeWidth={1} />,
        );
      }
    }
  }

  const tickLabels = (orient: 'h' | 'v') => {
    const out: React.ReactNode[] = [];
    const start = orient === 'h' ? view.x : view.y;
    const len = (orient === 'h' ? plotW : plotH) / view.scale;
    const first = Math.ceil(start / step) * step;
    let guard = 0;
    for (let v = first; v <= start + len && guard < 200; v += step, guard++) {
      const pos = orient === 'h' ? mmX(v) : mmY(v);
      const label = v.toFixed(dec).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
      if (orient === 'h') {
        out.push(
          <g key={`tx${v.toFixed(6)}`}>
            <line x1={pos} y1={RULER - 6} x2={pos} y2={size.h} stroke="#22303d" strokeWidth={1} />
            <text x={pos + 4} y={12} fill="#6f8598" fontSize={9.5} fontFamily={MONO}>
              {label}
            </text>
          </g>,
        );
      } else {
        out.push(
          <g key={`ty${v.toFixed(6)}`}>
            <line x1={RULER - 6} y1={pos} x2={size.w} y2={pos} stroke="#22303d" strokeWidth={1} />
            <text
              x={10}
              y={pos - 4}
              fill="#6f8598"
              fontSize={9.5}
              fontFamily={MONO}
              textAnchor="end"
              transform={`rotate(-90 10 ${pos - 4})`}
            >
              {label}
            </text>
          </g>,
        );
      }
    }
    return out;
  };

  const selDrop = selection?.kind === 'drop' ? selection : null;

  return (
    <div
      className={`canvas-wrap${panning ? ' dragging' : ''}`}
      ref={wrapRef}
      style={{ cursor: panning ? 'grabbing' : 'default' }}
    >
      <svg
        ref={svgRef}
        onPointerLeave={() => onCursorMove(null)}
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={onFit}
      >
        <defs>
          <pattern id="inkRows" width={1} height={Math.max(pitch, 1e-6)} patternUnits="userSpaceOnUse">
            <rect x={0} y={0} width={1} height={Math.max(pitch, 1e-6)} fill="#2ee6a8" fillOpacity={0.3} />
            <rect x={0} y={0} width={1} height={Math.max(pitch, 1e-6) * 0.62} fill="#2ee6a8" fillOpacity={0.62} />
          </pattern>
          <pattern
            id="leaderHatch"
            width={8 / view.scale}
            height={8 / view.scale}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={8 / view.scale}
              stroke="#e9a13b"
              strokeOpacity={0.45}
              strokeWidth={1 / view.scale}
            />
          </pattern>
          <clipPath id="plotClip">
            <rect x={RULER} y={RULER} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        <rect x={0} y={0} width={size.w} height={size.h} fill="transparent" />

        <g clipPath="url(#plotClip)">
          {gridLines}

          <g transform={`translate(${RULER} ${RULER}) scale(${view.scale}) translate(${-view.x} ${-view.y})`}>
            {/* substrate / print area */}
            <rect
              x={g.left}
              y={g.top}
              width={g.width}
              height={g.height}
              fill="#0f1620"
              stroke="#2d3f4f"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />

            {/* leader bar */}
            {g.useLeaderBar && g.leaderBarWidth > 0 && (
              <g>
                <rect
                  x={0}
                  y={0}
                  width={g.leaderBarWidth}
                  height={g.height}
                  fill="url(#leaderHatch)"
                  fillOpacity={0.35}
                  stroke="rgba(233,161,59,0.55)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {g.leaderBarGap > 0 && (
                  <rect
                    x={g.leaderBarWidth}
                    y={0}
                    width={g.leaderBarGap}
                    height={g.height}
                    fill="none"
                    stroke="rgba(233,161,59,0.22)"
                    strokeDasharray="1 4"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            )}

            {/* blocks */}
            {instances.map((inst, ii) => {
              const blk = pattern.blocks[inst.blockIndex];
              const isSelBlock = selection?.kind === 'block' && selection.bi === inst.blockIndex;
              return (
                <g key={`b${ii}`}>
                  <rect
                    x={inst.left}
                    y={inst.top}
                    width={inst.width}
                    height={inst.height}
                    fill="none"
                    stroke={isSelBlock ? '#4cc3ff' : '#3a4f61'}
                    strokeWidth={1}
                    strokeDasharray={isSelBlock ? undefined : '4 3'}
                    vectorEffect="non-scaling-stroke"
                  />
                  {inst.copyX === 0 && inst.copyY === 0 && (() => {
                    // label above the block when there is room, else just inside it
                    const outside = inst.top - view.y > 18 / view.scale;
                    return (
                      <text
                        x={inst.left + 1 / view.scale}
                        y={outside ? inst.top - 5 / view.scale : inst.top + 11 / view.scale}
                        fill="#6d8698"
                        fontFamily={MONO}
                        fontSize={9 / view.scale}
                        paintOrder="stroke"
                        stroke="#0b1117"
                        strokeWidth={3 / view.scale}
                      >
                        {`B${inst.blockIndex + 1}  ${fmtNum(blk.width)}×${fmtNum(blk.height)}`}
                      </text>
                    );
                  })()}
                </g>
              );
            })}

            {/* ink */}
            {instances.map((inst: BlockInstance, ii: number) =>
              pattern.blocks[inst.blockIndex].drops.map((d, di) => {
                const isSel = isRefSelected(selection, inst.blockIndex, di) && inst.copyX === 0 && inst.copyY === 0;
                const raster = mode === 'raster';
                // physical height (print raster quantises a sub-jet drop to one row)
                const hPhys = raster ? Math.max(d.yHeight, pitch) : d.yHeight;
                // legibility floor: a 10 µm row is 0.4 px at fit zoom — always draw 1.4 px
                const h = Math.max(hPhys, 1.4 / view.scale);
                return (
                  <g
                    key={`d${ii}-${di}`}
                    transform={`translate(${inst.left + d.startX} ${inst.top + d.startY})`}
                    data-drop="1"
                    data-bi={inst.blockIndex}
                    data-di={di}
                    style={{ cursor: 'move' }}
                    onPointerEnter={(e) => setHover({ bi: inst.blockIndex, di, px: e.clientX, py: e.clientY })}
                    onPointerLeave={() => setHover(null)}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={d.xWidth}
                      height={h}
                      fill={showStripes ? 'none' : 'rgba(46,230,168,0.55)'}
                    />
                    {showStripes && (
                      <rect x={0} y={0} width={d.xWidth} height={h} fill="url(#inkRows)" />
                    )}
                    <rect
                      x={0}
                      y={0}
                      width={d.xWidth}
                      height={h}
                      fill="none"
                      stroke={isSel ? '#ffffff' : 'rgba(9,40,32,0.9)'}
                      strokeWidth={isSel ? 1.6 : 0.7}
                      vectorEffect="non-scaling-stroke"
                    />
                    {/* generous hit area so a 10 um hairline is still grabbable */}
                    <rect
                      x={0}
                      y={-Math.max(0, (12 / view.scale - h) / 2)}
                      width={d.xWidth}
                      height={Math.max(h, 12 / view.scale)}
                      fill="transparent"
                    />
                  </g>
                );
              }),
            )}

            {/* multi-selection bounds */}
            {selection?.kind === 'drops' &&
              (() => {
                const refs = selection.items;
                let l = Infinity;
                let t = Infinity;
                let r = -Infinity;
                let b = -Infinity;
                for (const ref of refs) {
                  const blk = pattern.blocks[ref.bi];
                  const d = blk?.drops[ref.di];
                  if (!blk || !d) continue;
                  l = Math.min(l, blk.left + d.startX);
                  t = Math.min(t, blk.top + d.startY);
                  r = Math.max(r, blk.left + d.startX + d.xWidth);
                  b = Math.max(b, blk.top + d.startY + Math.max(d.yHeight, pitch));
                }
                if (!Number.isFinite(l)) return null;
                return (
                  <g pointerEvents="none">
                    <rect
                      x={l - 3 / view.scale}
                      y={t - 3 / view.scale}
                      width={r - l + 6 / view.scale}
                      height={b - t + 6 / view.scale}
                      fill="rgba(76,195,255,0.07)"
                      stroke="#4cc3ff"
                      strokeWidth={1.2}
                      strokeDasharray="5 3"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={l}
                      y={t - 8 / view.scale}
                      fill="#8fd8ff"
                      fontFamily={MONO}
                      fontSize={9.5 / view.scale}
                      paintOrder="stroke"
                      stroke="#0b1117"
                      strokeWidth={3 / view.scale}
                    >
                      {`${refs.length} selected`}
                    </text>
                  </g>
                );
              })()}

            {/* selection handles */}
            {selDrop &&
              (() => {
                const inst = instances.find(
                  (i) => i.blockIndex === selDrop.bi && i.copyX === 0 && i.copyY === 0,
                );
                const d = pattern.blocks[selDrop.bi]?.drops[selDrop.di];
                if (!inst || !d) return null;
                const x = inst.left + d.startX;
                const y = inst.top + d.startY;
                const w = d.xWidth;
                const h = Math.max(mode === 'raster' ? Math.max(d.yHeight, pitch) : d.yHeight, 1.4 / view.scale);
                const hs = 8 / view.scale;
                const tall = h * view.scale >= 16;
                const handles: Array<[string, number, number]> = [
                  ['nw', x, y],
                  ...(tall ? ([['n', x + w / 2, y]] as Array<[string, number, number]>) : []),
                  ['ne', x + w, y],
                  ...(tall ? ([['e', x + w, y + h / 2]] as Array<[string, number, number]>) : []),
                  ['se', x + w, y + h],
                  ...(tall ? ([['s', x + w / 2, y + h]] as Array<[string, number, number]>) : []),
                  ['sw', x, y + h],
                  ...(tall ? ([['w', x, y + h / 2]] as Array<[string, number, number]>) : []),
                ];
                const cursorFor = (k: string) =>
                  k === 'nw' || k === 'se' ? 'nwse-resize' : k === 'ne' || k === 'sw' ? 'nesw-resize' : k === 'n' || k === 's' ? 'ns-resize' : 'ew-resize';
                return (
                  <g>
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={Math.max(h, 1e-9)}
                      fill="none"
                      stroke="#4cc3ff"
                      strokeWidth={1.4}
                      strokeDasharray="3 2"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    {handles.map(([k, hx, hy]) => (
                      <rect
                        key={k}
                        data-handle={k}
                        data-bi={selDrop.bi}
                        data-di={selDrop.di}
                        x={hx - hs / 2}
                        y={hy - hs / 2}
                        width={hs}
                        height={hs}
                        fill="#0b1117"
                        stroke="#4cc3ff"
                        strokeWidth={1.3}
                        vectorEffect="non-scaling-stroke"
                        style={{ cursor: cursorFor(k) }}
                      />
                    ))}
                  </g>
                );
              })()}

            {/* create preview */}
            {preview && preview.w > 0 && preview.h > 0 && (
              <rect
                x={preview.x}
                y={preview.y}
                width={preview.w}
                height={Math.max(preview.h, 1.4 / view.scale)}
                fill="rgba(46,230,168,0.28)"
                stroke="#2ee6a8"
                strokeWidth={1.4}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}

            {/* snap guides */}
            {guides.x.map((gx) => (
              <line
                key={`sgx${gx}`}
                x1={gx}
                y1={view.y}
                x2={gx}
                y2={view.y + plotH / view.scale}
                stroke="#4cc3ff"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
            {guides.y.map((gy) => (
              <line
                key={`sgy${gy}`}
                x1={view.x}
                y1={gy}
                x2={view.x + plotW / view.scale}
                y2={gy}
                stroke="#4cc3ff"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
          </g>
        </g>

        {/* rulers */}
        <rect x={0} y={0} width={size.w} height={RULER} fill="#0c1218" />
        <rect x={0} y={0} width={RULER} height={size.h} fill="#0c1218" />
        <line x1={0} y1={RULER} x2={size.w} y2={RULER} stroke="#20303c" strokeWidth={1} />
        <line x1={RULER} y1={0} x2={RULER} y2={size.h} stroke="#20303c" strokeWidth={1} />
        {tickLabels('h')}
        {tickLabels('v')}
        <rect x={0} y={0} width={RULER} height={RULER} fill="#0b1117" stroke="#20303c" strokeWidth={1} />
        <text x={RULER / 2} y={RULER / 2 + 3.5} textAnchor="middle" fill="#4a5f71" fontSize={9} fontFamily={MONO}>
          mm
        </text>
      </svg>

      <div className="canvas-hud">
        <span className="chip">
          <span className="k">area</span>
          <span className="v">
            {fmtNum(g.width)} × {fmtNum(g.height)} mm
          </span>
        </span>
        <span className="chip">
          <span className="k">jet</span>
          <span className="v">{fmtNum(g.jetSpacing)} µm</span>
        </span>
        <span className="chip">
          <span className="k">layers</span>
          <span className="v">{Math.max(1, Math.round(g.layerCount || 1))}</span>
        </span>
        {mode === 'raster' && (
          <span className="chip in">
            <span className="k">print raster</span>
            <span className="v">{fmtNum(pitch * 1000)} µm rows</span>
          </span>
        )}
        {g.useLeaderBar && (
          <span className="chip" style={{ borderColor: 'rgba(233,161,59,0.3)', color: '#d8a45a' }}>
            <span className="k">leader</span>
            <span className="v" style={{ color: '#e0b273' }}>
              {fmtNum(g.leaderBarWidth)} mm + {fmtNum(g.leaderBarGap)} gap
            </span>
          </span>
        )}
        <span className="chip" style={{ opacity: snap ? 1 : 0.45 }}>
          <span className="k">snap</span>
          <span className="v">
            {snap ? `${fmtNum(snapStep)} mm${snapFeatures ? ' + edges' : ''}` : 'off'}
          </span>
        </span>
        <span className="chip">
          <span className="k">cursor</span>
          <span className="v" ref={cursorRef}>
            —
          </span>
        </span>
      </div>

      <div className="zoom-box" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className="icon-btn"
          title="Zoom out"
          onClick={() => {
            const r = svgRef.current?.getBoundingClientRect();
            zoomAt(1 / 1.35, (r?.left ?? 0) + RULER + plotW / 2, (r?.top ?? 0) + RULER + plotH / 2);
          }}
        >
          {Icon.minus}
        </button>
        <span className="pct">{zoomLabel(view.scale)}</span>
        <button
          className="icon-btn"
          title="Zoom in"
          onClick={() => {
            const r = svgRef.current?.getBoundingClientRect();
            zoomAt(1.35, (r?.left ?? 0) + RULER + plotW / 2, (r?.top ?? 0) + RULER + plotH / 2);
          }}
        >
          {Icon.plus}
        </button>
        <button className="icon-btn" title="Fit pattern" onClick={onFit}>
          {Icon.fit}
        </button>
      </div>

      {hover && (() => {
        const blk = pattern.blocks[hover.bi];
        const d = blk?.drops[hover.di];
        if (!d) return null;
        const rows = jetRows(d, pitch);
        const left = Math.min(size.w - 250, hover.px + 14);
        const top = Math.min(size.h - 120, hover.py + 14);
        return (
          <div className="tooltip" style={{ left, top }}>
            <div>
              <b>DROP</b> block {hover.bi + 1} · {hover.di + 1}
            </div>
            <div>
              x {fmtNum(d.startX)} → {fmtNum(d.startX + d.xWidth)} mm
            </div>
            <div>
              y {fmtNum(d.startY)} → {fmtNum(d.startY + d.yHeight)} mm
            </div>
            <div>
              <b>{fmtNum(d.xWidth)} × {fmtNum(d.yHeight)} mm</b>
            </div>
            <div>
              {rows} jet row{rows === 1 ? '' : 's'} · {fmtNum(rows * pitch * 1000)} µm tall
            </div>
          </div>
        );
      })()}
    </div>
  );
}
