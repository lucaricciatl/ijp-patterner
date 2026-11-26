import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Canvas, { RULER, niceStep, zoomLabel, type DropRef, type Selection, type View } from './components/Canvas';
import Sidebar from './components/Sidebar';
import Inspector from './components/Inspector';
import Toolbar, { type RecentFile } from './components/Toolbar';
import { HelpDialog, TemplateDialog, XmlDialog } from './components/Dialogs';
import LibraryDialog from './components/LibraryDialog';
import ImportDialog from './components/ImportDialog';
import {
  buildTemplate,
  defaultParams,
  fitPrintArea as fitPrintAreaOf,
  patternFromDrops,
  type TemplateId,
  type TemplateParams,
} from './lib/templates';
import {
  fmtMm as fmtNum,
  parsePattern,
  patternFileName,
  serializePattern,
  type Drop,
  type GeneralConfig,
  type Pattern,
  type PatternBlock,
} from './lib/ptn';
import { jetPitch, patternBounds, stats } from './lib/geometry';
import { clipBounds, encodeClip, parseClip, type Clip } from './lib/clipboard';
import { patternToSvg, svgToPngBase64 } from './lib/exportSvg';
import { Icon } from './components/ui';

/* -------------------------------------------------------------- history --- */

function useHistory(initial: Pattern) {
  const [st, setSt] = useState<{ past: Pattern[]; present: Pattern; future: Pattern[] }>({
    past: [],
    present: initial,
    future: [],
  });

  const push = useCallback((fn: (p: Pattern) => Pattern) => {
    setSt((s) => {
      const next = fn(s.present);
      if (next === s.present) return s;
      return { past: [...s.past.slice(-79), s.present], present: next, future: [] };
    });
  }, []);

  const live = useCallback((fn: (p: Pattern) => Pattern) => {
    setSt((s) => ({ ...s, present: fn(s.present) }));
  }, []);

  const snapshot = useCallback(() => {
    setSt((s) => ({ past: [...s.past.slice(-79), s.present], present: s.present, future: [] }));
  }, []);

  const undo = useCallback(() => {
    setSt((s) => {
      if (!s.past.length) return s;
      return {
        past: s.past.slice(0, -1),
        present: s.past[s.past.length - 1],
        future: [s.present, ...s.future].slice(0, 80),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setSt((s) => {
      if (!s.future.length) return s;
      return { past: [...s.past, s.present].slice(-80), present: s.future[0], future: s.future.slice(1) };
    });
  }, []);

  const reset = useCallback((p: Pattern) => {
    setSt({ past: [], present: p, future: [] });
  }, []);

  return {
    pattern: st.present,
    push,
    live,
    snapshot,
    undo,
    redo,
    reset,
    canUndo: st.past.length > 0,
    canRedo: st.future.length > 0,
  };
}

function activeTextField(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
}

function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const RECENT_KEY = 'ijp-patterner.recent';

function loadRecents(): RecentFile[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentFile[];
    return Array.isArray(list) ? list.slice(0, 8) : [];
  } catch {
    return [];
  }
}

type FileRef = { path: string; name: string; dir: string } | null;

export default function App() {
  const hist = useHistory(buildTemplate('film', defaultParams));
  const pattern = hist.pattern;

  const [file, setFile] = useState<FileRef>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [mode, setMode] = useState<'design' | 'raster'>('raster');
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [snapStep, setSnapStep] = useState<number | null>(null);
  const [snapFeatures, setSnapFeatures] = useState(true);
  const [clip, setClip] = useState<Clip | null>(null);
  const cursorMm = useRef<{ x: number; y: number } | null>(null);
  const pasteCount = useRef(0);
  const handleCursorMove = useCallback((mm: { x: number; y: number } | null) => {
    cursorMm.current = mm;
  }, []);
  const [view, setView] = useState<View>({ x: -0.5, y: -0.5, scale: 60 });
  const [size, setSize] = useState({ w: 1000, h: 640 });
  const [showTemplate, setShowTemplate] = useState(false);
  const [showXml, setShowXml] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [importFile, setImportFile] = useState<{ svg: string; name: string } | null>(null);
  const [recents, setRecents] = useState<RecentFile[]>(loadRecents);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [dropping, setDropping] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  const xml = useMemo(() => serializePattern(pattern), [pattern]);
  const [savedXml, setSavedXml] = useState(() => serializePattern(pattern));
  const dirty = xml !== savedXml;

  const say = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), err ? 5200 : 2400);
  }, []);

  /* ------------------------------------------------------------- title --- */

  useEffect(() => {
    window.patterner?.setDirty(dirty);
    window.patterner?.setTitle(`${file?.name ?? 'Untitled pattern'}${dirty ? ' •' : ''}`);
    document.title = `${file?.name ?? 'Untitled'}${dirty ? ' •' : ''} — IJP Patterner`;
  }, [dirty, file]);

  /* -------------------------------------------------------------- view --- */

  const patternRef = useRef(pattern);
  patternRef.current = pattern;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [fitToken, requestFit] = useReducer((n: number) => n + 1, 0);

  // Always fits the *current* pattern and canvas: the effect below re-reads the
  // refs, so a fit requested at load time cannot run against a stale pattern.
  const fitView = useCallback(() => {
    const p = patternRef.current;
    const sz = sizeRef.current;
    const b = patternBounds(p);
    const bw = Math.max(1e-4, b.x1 - b.x0);
    const bh = Math.max(1e-4, b.y1 - b.y0);
    const availW = Math.max(80, sz.w - RULER - 96);
    const availH = Math.max(80, sz.h - RULER - 96);
    const scale = Math.min(12000, Math.max(0.05, Math.min(availW / bw, availH / bh)));
    setView({
      scale,
      x: b.x0 - (sz.w - RULER - bw * scale) / 2 / scale,
      y: b.y0 - (sz.h - RULER - bh * scale) / 2 / scale,
    });
  }, []);

  useEffect(() => {
    fitView();
  }, [fitToken, fitView]);

  const handleSize = useCallback(
    (s: { w: number; h: number }) => {
      if (sizeRef.current.w === s.w && sizeRef.current.h === s.h) return;
      sizeRef.current = s;
      setSize(s);
      requestFit();
    },
    [requestFit],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const scale = Math.min(30000, Math.max(0.03, view.scale * factor));
      const cx = (size.w - RULER) / 2;
      const cy = (size.h - RULER) / 2;
      const mx = view.x + cx / view.scale;
      const my = view.y + cy / view.scale;
      setView({ scale, x: mx - cx / scale, y: my - cy / scale });
    },
    [view, size],
  );

  /* ------------------------------------------------------------ editing --- */

  const updateGeneral = (patch: Partial<GeneralConfig>) =>
    hist.push((p) => ({ ...p, general: { ...p.general, ...patch } }));

  const updateBlock = (bi: number, patch: Partial<PatternBlock>) =>
    hist.push((p) => ({
      ...p,
      blocks: p.blocks.map((b, i) => (i === bi ? { ...b, ...patch } : b)),
    }));

  const updateDrop = (bi: number, di: number, patch: Partial<Drop>, live = false) => {
    const apply = (p: Pattern) => ({
      ...p,
      blocks: p.blocks.map((b, i) =>
        i === bi ? { ...b, drops: b.drops.map((d, j) => (j === di ? { ...d, ...patch } : d)) } : b,
      ),
    });
    if (live) hist.live(apply);
    else hist.push(apply);
  };

  const addBlock = () =>
    hist.push((p) => {
      const g = p.general;
      const x0 = g.useLeaderBar ? g.leaderBarWidth + g.leaderBarGap : 0;
      const w = Math.max(0.5, Math.min(10, g.width - x0));
      const h = Math.max(0.5, Math.min(10, g.height));
      return {
        ...p,
        blocks: [
          ...p.blocks,
          {
            left: x0,
            top: 0,
            width: w,
            height: h,
            xSpacing: w,
            ySpacing: h,
            maxXCount: 1,
            maxYCount: 1,
            drops: [{ startX: 0, startY: 0, xWidth: w, yHeight: h, extra: [] }],
            extra: [],
          },
        ],
      };
    });

  const moveDrops = (refs: DropRef[], values: Array<{ startX: number; startY: number }>, live = false) => {
    const apply = (p: Pattern) => ({
      ...p,
      blocks: p.blocks.map((b, i) => {
        const touched = refs.map((r, k) => (r.bi === i ? k : -1)).filter((k) => k >= 0);
        if (touched.length === 0) return b;
        const drops = b.drops.slice();
        for (const k of touched) {
          const target = values[k];
          const d = drops[refs[k].di];
          if (!target || !d) continue;
          drops[refs[k].di] = { ...d, startX: target.startX, startY: target.startY };
        }
        return { ...b, drops };
      }),
    });
    if (live) hist.live(apply);
    else hist.push(apply);
  };

  const createDrop = (bi: number, d: Drop) =>
    hist.live((p) => ({
      ...p,
      blocks: p.blocks.map((b, i) => (i === bi ? { ...b, drops: [...b.drops, d] } : b)),
    }));

  const addDrop = (bi: number) =>
    hist.push((p) => {
      const b = p.blocks[bi];
      if (!b) return p;
      const pitch = jetPitch(p);
      const y = Math.min(b.height - pitch, b.drops.reduce((acc, d) => Math.max(acc, d.startY + d.yHeight), 0) + pitch * 2);
      const d: Drop = {
        startX: 0,
        startY: Math.max(0, Number(y.toFixed(6))),
        xWidth: Math.max(pitch, Number((b.width / 2).toFixed(6))),
        yHeight: pitch,
        extra: [],
      };
      return {
        ...p,
        blocks: p.blocks.map((bb, i) => (i === bi ? { ...bb, drops: [...bb.drops, d] } : bb)),
      };
    });

  const deleteDrop = (bi: number, di: number) => {
    hist.push((p) => ({
      ...p,
      blocks: p.blocks.map((b, i) => (i === bi ? { ...b, drops: b.drops.filter((_, j) => j !== di) } : b)),
    }));
    setSelection(null);
  };

  const deleteBlock = (bi: number) => {
    hist.push((p) => ({ ...p, blocks: p.blocks.filter((_, i) => i !== bi) }));
    setSelection(null);
  };

  const deleteSelection = () => {
    if (!selection) return;
    if (selection.kind === 'drop') deleteDrop(selection.bi, selection.di);
    else if (selection.kind === 'block') deleteBlock(selection.bi);
    else if (selection.kind === 'drops') {
      const items = selection.items;
      hist.push((p) => ({
        ...p,
        blocks: p.blocks.map((b, i) => {
          const idx = new Set(items.filter((r) => r.bi === i).map((r) => r.di));
          return idx.size ? { ...b, drops: b.drops.filter((_, j) => !idx.has(j)) } : b;
        }),
      }));
      setSelection(null);
    }
  };

  const duplicateSelection = () => {
    if (!selection || selection.kind === 'general') return;

    if (selection.kind === 'drops') {
      const items = selection.items;
      const step = Math.max(0.5, jetPitch(pattern) * 10);
      const next: DropRef[] = [];
      for (const r of items) {
        const b = pattern.blocks[r.bi];
        if (b) next.push({ bi: r.bi, di: b.drops.length + next.filter((n) => n.bi === r.bi).length });
      }
      hist.push((p) => ({
        ...p,
        blocks: p.blocks.map((b, i) => {
          const add = items
            .filter((r) => r.bi === i)
            .map((r) => b.drops[r.di])
            .filter(Boolean)
            .map((d) => ({ ...d, startX: d.startX + step, startY: d.startY + step, extra: [] }));
          return add.length ? { ...b, drops: [...b.drops, ...add] } : b;
        }),
      }));
      if (next.length > 1) setSelection({ kind: 'drops', items: next });
      else if (next.length === 1) setSelection({ kind: 'drop', bi: next[0].bi, di: next[0].di });
      return;
    }
    if (selection.kind === 'drop') {
      const { bi, di } = selection;
      const src = pattern.blocks[bi]?.drops[di];
      if (!src) return;
      const pitch = jetPitch(pattern);
      hist.push((p) => ({
        ...p,
        blocks: p.blocks.map((b, i) =>
          i === bi
            ? { ...b, drops: [...b.drops, { ...src, startY: Number((src.startY + Math.max(pitch * 2, 0.05)).toFixed(6)) }] }
            : b,
        ),
      }));
      setSelection({ kind: 'drop', bi, di: pattern.blocks[bi].drops.length });
    } else {
      const bi = selection.bi;
      hist.push((p) => {
        const src = p.blocks[bi];
        if (!src) return p;
        return {
          ...p,
          blocks: [
            ...p.blocks,
            {
              ...src,
              top: Number((src.top + src.height).toFixed(6)),
              drops: src.drops.map((d) => ({ ...d, extra: [...(d.extra ?? [])] })),
            },
          ],
        };
      });
      setSelection({ kind: 'block', bi: pattern.blocks.length });
    }
  };

  /* ---------------------------------------------------------- clipboard --- */

  const copySelection = useCallback(
    async (cut = false) => {
      if (!selection || selection.kind === 'general') {
        say('Select a drop or a block first', true);
        return;
      }
      let payload: Clip;
      if (selection.kind === 'drops') {
        const drops = selection.items
          .map((r) => pattern.blocks[r.bi]?.drops[r.di])
          .filter((d): d is Drop => !!d)
          .map((d) => ({ startX: d.startX, startY: d.startY, xWidth: d.xWidth, yHeight: d.yHeight }));
        if (drops.length === 0) return;
        payload = { kind: 'drops', drops };
      } else if (selection.kind === 'drop') {
        const blk = pattern.blocks[selection.bi];
        const d = blk?.drops[selection.di];
        if (!blk || !d) return;
        payload = { kind: 'drops', drops: [{ startX: d.startX, startY: d.startY, xWidth: d.xWidth, yHeight: d.yHeight }] };
      } else {
        const blk = pattern.blocks[selection.bi];
        if (!blk) return;
        payload = {
          kind: 'block',
          left: blk.left,
          top: blk.top,
          width: blk.width,
          height: blk.height,
          drops: blk.drops.map((d) => ({ startX: d.startX, startY: d.startY, xWidth: d.xWidth, yHeight: d.yHeight })),
        };
      }

      setClip(payload);
      pasteCount.current = 0;
      const text = encodeClip(payload);
      try {
        if (window.patterner?.writeClipboard) await window.patterner.writeClipboard(text);
        else await navigator.clipboard.writeText(text);
      } catch {
        /* clipboard unavailable: the in-app clipboard still works */
      }

      if (cut) {
        deleteSelection();
        say(payload.kind === 'block' ? 'Cut block' : 'Cut drop');
      } else {
        say(payload.kind === 'block' ? `Copied block (${payload.drops.length} drops)` : 'Copied drop');
      }
    },
    [selection, pattern, say],
  );

  const paste = useCallback(
    async (inPlace = false) => {
      let payload = clip;
      if (!payload) {
        try {
          const text = window.patterner?.readClipboard
            ? await window.patterner.readClipboard()
            : await navigator.clipboard.readText();
          payload = parseClip(text);
        } catch {
          payload = null;
        }
      }
      if (!payload) {
        say('Nothing to paste', true);
        return;
      }
      if (pattern.blocks.length === 0) {
        say('Add a block first', true);
        return;
      }

      const bi =
        selection && 'bi' in selection && pattern.blocks[selection.bi]
          ? selection.bi
          : Math.max(0, pattern.blocks.length - 1);
      const blk = pattern.blocks[bi];
      const pitch = jetPitch(pattern);

      if (payload.kind === 'block') {
        const gap = Math.max(1, pitch * 20);
        let left = blk.left + blk.width + gap;
        let top = blk.top;
        if (left + payload.width > pattern.general.width) {
          left = Math.max(0, blk.left);
          top = blk.top + blk.height + gap;
        }
        const block = {
          left: Number(left.toFixed(6)),
          top: Number(top.toFixed(6)),
          width: payload.width,
          height: payload.height,
          xSpacing: payload.width,
          ySpacing: payload.height,
          maxXCount: 1,
          maxYCount: 1,
          drops: payload.drops.map((d) => ({ ...d, extra: [] })),
          extra: [],
        };
        hist.push((p) => fitPrintAreaOf({ ...p, blocks: [...p.blocks, block] }));
        setSelection({ kind: 'block', bi: pattern.blocks.length });
        requestFit();
        say(`Pasted block (${payload.drops.length} drops)`);
        return;
      }

      const bounds = clipBounds(payload);
      const cur = cursorMm.current;
      const inside =
        !!cur && cur.x >= blk.left && cur.x <= blk.left + blk.width && cur.y >= blk.top && cur.y <= blk.top + blk.height;

      const step = Math.max(0.5, pitch * 10);
      let ox: number;
      let oy: number;
      if (inPlace) {
        ox = 0;
        oy = 0;
      } else if (inside && cur) {
        ox = cur.x - blk.left - bounds.x;
        oy = cur.y - blk.top - bounds.y;
      } else {
        pasteCount.current += 1;
        ox = pasteCount.current * step;
        oy = pasteCount.current * step;
      }

      const clampX = (v: number, w: number) => Math.min(Math.max(0, v), Math.max(0, blk.width - w));
      const clampY = (v: number, h: number) => Math.min(Math.max(0, v), Math.max(0, blk.height - h));
      const newDrops: Drop[] = payload.drops.map((d) => ({
        startX: Number(clampX(d.startX + ox, d.xWidth).toFixed(6)),
        startY: Number(clampY(d.startY + oy, d.yHeight).toFixed(6)),
        xWidth: d.xWidth,
        yHeight: d.yHeight,
        extra: [],
      }));

      hist.push((p) => ({
        ...p,
        blocks: p.blocks.map((b, i) => (i === bi ? { ...b, drops: [...b.drops, ...newDrops] } : b)),
      }));
      setSelection({ kind: 'drop', bi, di: blk.drops.length });
      say(newDrops.length === 1 ? 'Pasted drop' : `Pasted ${newDrops.length} drops`);
    },
    [clip, selection, pattern, say, hist],
  );

  const clipAction = useCallback(
    (action: 'copy' | 'cut' | 'paste' | 'paste-in-place') => {
      const field = activeTextField();
      if (field) {
        if (action === 'copy') document.execCommand('copy');
        else if (action === 'cut') document.execCommand('cut');
        else if (action === 'paste' || action === 'paste-in-place') {
          void navigator.clipboard
            .readText()
            .then((text) => insertIntoField(field, text))
            .catch(() => {});
        }
        return;
      }
      if (action === 'copy') void copySelection(false);
      else if (action === 'cut') void copySelection(true);
      else void paste(action === 'paste-in-place');
    },
    [copySelection, paste],
  );

  const fitPrintArea = () => hist.push((p) => fitPrintAreaOf(p));

  // undo/redo can remove the block or drop a selection points at
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === 'drop') {
      const b = pattern.blocks[selection.bi];
      if (!b) setSelection(null);
      else if (!b.drops[selection.di]) setSelection({ kind: 'block', bi: selection.bi });
    } else if (selection.kind === 'block' && !pattern.blocks[selection.bi]) {
      setSelection(null);
    } else if (selection.kind === 'drops') {
      const alive = selection.items.filter((r) => pattern.blocks[r.bi]?.drops[r.di]);
      if (alive.length !== selection.items.length) {
        if (alive.length === 0) setSelection(null);
        else if (alive.length === 1) setSelection({ kind: 'drop', bi: alive[0].bi, di: alive[0].di });
        else setSelection({ kind: 'drops', items: alive });
      }
    }
  }, [pattern, selection]);

  /* --------------------------------------------------------------- files --- */

  const remember = (path: string, name: string) => {
    setRecents((prev) => {
      const next = [{ path, name }, ...prev.filter((r) => r.path !== path)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  };

  const adopt = useCallback(
    (p: Pattern, f: FileRef) => {
      hist.reset(p);
      setFile(f);
      setSavedXml(serializePattern(p));
      setSelection(null);
      requestFit();
    },
    [hist],
  );

  const loadXml = useCallback(
    (text: string, f: FileRef) => {
      try {
        const p = parsePattern(text);
        adopt(p, f);
        if (f) remember(f.path, f.name);
        say(`Opened ${f?.name ?? 'pattern'}`);
      } catch (err) {
        say(`Could not read pattern: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
    [adopt, say],
  );

  const openDialog = useCallback(async () => {
    const api = window.patterner;
    if (!api) {
      say('File system is only available in the desktop app.', true);
      return;
    }
    const res = await api.openDialog();
    if (res.canceled) return;
    if (res.error) return say(res.error, true);
    const first = res.files?.[0];
    if (!first) return;
    loadXml(first.xml, { path: first.path, name: first.name, dir: first.dir });
    if (res.files && res.files.length > 1) say(`Opened ${first.name} of ${res.files.length} files`);
  }, [loadXml, say]);

  const openPath = useCallback(
    async (path: string) => {
      const api = window.patterner;
      if (!api) return;
      const res = await api.readFile(path);
      if (res.error) return say(res.error, true);
      loadXml(res.xml, { path: res.path, name: res.name, dir: res.dir });
    },
    [loadXml, say],
  );

  const save = useCallback(
    async (asNew = false): Promise<boolean> => {
      const api = window.patterner;
      if (!api) {
        say('File system is only available in the desktop app.', true);
        return false;
      }
      const res = await api.save({
        path: asNew ? null : file?.path ?? null,
        xml,
        defaultName: file?.name ?? patternFileName(pattern),
      });
      if (res.canceled) return false;
      if (res.error) {
        say(res.error, true);
        return false;
      }
      if (res.path && res.name && res.dir) {
        setFile({ path: res.path, name: res.name, dir: res.dir });
        setSavedXml(xml);
        remember(res.path, res.name);
        say(`Saved ${res.name}`);
      }
      return true;
    },
    [file, xml, pattern, say],
  );

  const exportSvg = useCallback(async () => {
    const api = window.patterner;
    const svg = patternToSvg(pattern, {
      footer: `${file?.name ?? 'pattern'} · ${fmtNum(pattern.general.width)} × ${fmtNum(
        pattern.general.height,
      )} mm · ${fmtNum(pattern.general.jetSpacing)} µm jets`,
    });
    if (!api) {
      await navigator.clipboard.writeText(svg).catch(() => {});
      say('SVG copied to clipboard');
      return;
    }
    const res = await api.exportFile({
      data: svg,
      defaultName: (file?.name ?? patternFileName(pattern)).replace(/\.ptn$/i, '') + '.svg',
      filters: [{ name: 'SVG', extensions: ['svg'] }],
    });
    if (res.canceled) return;
    if (res.error) return say(res.error, true);
    say('Preview exported');
  }, [pattern, file, say]);

  const exportPng = useCallback(async () => {
    const api = window.patterner;
    if (!api) return say('File system is only available in the desktop app.', true);
    try {
      const svg = patternToSvg(pattern);
      const { base64 } = await svgToPngBase64(svg, 2);
      const res = await api.exportFile({
        data: base64,
        defaultName: (file?.name ?? patternFileName(pattern)).replace(/\.ptn$/i, '') + '.png',
        filters: [{ name: 'PNG', extensions: ['png'] }],
        binary: true,
      });
      if (res.canceled) return;
      if (res.error) return say(res.error, true);
      say('PNG exported');
    } catch (err) {
      say(err instanceof Error ? err.message : 'Export failed', true);
    }
  }, [pattern, file, say]);

  const newFromTemplate = (id: TemplateId, params: TemplateParams) => {
    const p = buildTemplate(id, params);
    setShowTemplate(false);
    hist.reset(p);
    setFile(null);
    setSavedXml('');
    setSelection(null);
    requestFit();
    say(`New ${id} pattern`);
  };

  const openSvg = useCallback(async () => {
    const api = window.patterner;
    if (!api) return say('File system is only available in the desktop app.', true);
    const res = await api.openSvgDialog();
    if (res.canceled) return;
    if (res.error || !res.svg) return say(res.error ?? 'Could not read the SVG', true);
    setImportFile({ svg: res.svg, name: res.name ?? 'drawing.svg' });
  }, [say]);

  const adoptSvg = (drops: Drop[], width: number, height: number, jetSpacing: number) => {
    const p = patternFromDrops(drops, width, height, jetSpacing);
    setImportFile(null);
    hist.reset(p);
    setFile(null);
    setSavedXml('');
    setSelection({ kind: 'block', bi: 0 });
    requestFit();
    say(`Imported ${drops.length} drops from SVG`);
  };

  /* -------------------------------------------------------------- menus --- */

  useEffect(() => {
    const api = window.patterner;
    if (!api) return;
    return api.onMenu((action) => {
      switch (action) {
        case 'new':
          setShowTemplate(true);
          break;
        case 'open':
          void openDialog();
          break;
        case 'save':
          void save(false);
          break;
        case 'save-as':
          void save(true);
          break;
        case 'save-and-quit':
          void save(false).then((ok) => {
            if (ok) api.quitNow();
            else api.cancelQuit();
          });
          break;
        case 'export-svg':
          void exportSvg();
          break;
        case 'export-png':
          void exportPng();
          break;
        case 'undo':
          hist.undo();
          break;
        case 'redo':
          hist.redo();
          break;
        case 'duplicate':
          duplicateSelection();
          break;
        case 'copy':
        case 'cut':
        case 'paste':
        case 'paste-in-place':
          clipAction(action as 'copy' | 'cut' | 'paste' | 'paste-in-place');
          break;
        case 'delete':
          deleteSelection();
          break;
        case 'fit':
          fitView();
          break;
        case 'zoom-in':
          zoomBy(1.4);
          break;
        case 'zoom-out':
          zoomBy(1 / 1.4);
          break;
        case 'toggle-raster':
          setMode((m) => (m === 'raster' ? 'design' : 'raster'));
          break;
        case 'toggle-grid':
          setShowGrid((v) => !v);
          break;
        case 'help':
          setShowHelp(true);
          break;
        case 'import-svg':
          void openSvg();
          break;
        case 'library':
          setShowLibrary(true);
          break;
        default:
          break;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hist, openDialog, save, exportSvg, exportPng, pattern, selection, fitView, zoomBy]);

  /* ---------------------------------------------------------- shortcuts --- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (typing) return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' || k === 'x') {
          e.preventDefault();
          clipAction(k === 'x' ? 'cut' : 'copy');
          return;
        }
        if (k === 'v') {
          e.preventDefault();
          clipAction(e.shiftKey ? 'paste-in-place' : 'paste');
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection) {
          e.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (e.key === 'Escape') {
        setSelection(null);
        return;
      }
      if (e.key.startsWith('Arrow') && selection?.kind === 'drops') {
        e.preventDefault();
        const step = e.shiftKey ? Math.max(jetPitch(pattern), 0.01) : Math.max(jetPitch(pattern), 0.001);
        const dxs = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dys = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const values = selection.items.map((r) => {
          const d = pattern.blocks[r.bi]?.drops[r.di];
          return d
            ? { startX: Number(Math.max(0, d.startX + dxs).toFixed(6)), startY: Number(Math.max(0, d.startY + dys).toFixed(6)) }
            : { startX: 0, startY: 0 };
        });
        moveDrops(selection.items, values, false);
        return;
      }

      if (e.key.startsWith('Arrow') && selection?.kind === 'drop') {
        e.preventDefault();
        const step = e.shiftKey ? Math.max(jetPitch(pattern), 0.01) : Math.max(jetPitch(pattern), 0.001);
        const d = pattern.blocks[selection.bi]?.drops[selection.di];
        if (!d) return;
        const patch: Partial<Drop> = {};
        if (e.key === 'ArrowLeft') patch.startX = Math.max(0, d.startX - step);
        if (e.key === 'ArrowRight') patch.startX = d.startX + step;
        if (e.key === 'ArrowUp') patch.startY = Math.max(0, d.startY - step);
        if (e.key === 'ArrowDown') patch.startY = d.startY + step;
        updateDrop(selection.bi, selection.di, patch);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* --------------------------------------------------------- open-file --- */

  useEffect(() => {
    const api = window.patterner;
    if (!api?.onOpenPath) return;
    return api.onOpenPath((p) => void openPath(p));
  }, [openPath]);

  /* ------------------------------------------------------------ droptext --- */
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDropping(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDropping(false);
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (/\.svg$/i.test(f.name)) {
        setImportFile({ svg: await f.text(), name: f.name });
        return;
      }
      if (!/\.(ptn|xml)$/i.test(f.name)) return say('Drop a .ptn pattern or an .svg drawing', true);
      const api = window.patterner;
      const path = api?.pathForFile(f) ?? '';
      if (api && path) {
        const res = await api.readFile(path);
        if (res.error) return say(res.error, true);
        loadXml(res.xml, { path: res.path, name: res.name, dir: res.dir });
      } else {
        loadXml(await f.text(), null);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [loadXml, say]);

  /* ---------------------------------------------------------------- fit --- */


  // snap grid defaults to the grid actually drawn at this zoom (same niceStep as the canvas)
  const autoSnapStep = useMemo(() => niceStep(view.scale, 16), [view.scale]);
  const effectiveSnapStep = snapStep ?? autoSnapStep;

  const st = useMemo(() => stats(pattern), [pattern]);
  const selInfo = useMemo(() => {
    if (selection?.kind === 'drop') {
      const b = pattern.blocks[selection.bi];
      const d = b?.drops[selection.di];
      if (!b || !d) return 'No selection';
      return `drop ${selection.di + 1} · x ${fmtNum(b.left + d.startX)} y ${fmtNum(b.top + d.startY)} mm · ${fmtNum(
        d.xWidth,
      )} × ${fmtNum(d.yHeight)} mm`;
    }
    if (selection?.kind === 'drops') {
      return `${selection.items.length} drops selected`;
    }
    if (selection?.kind === 'block') {
      const b = pattern.blocks[selection.bi];
      return b ? `block ${selection.bi + 1} · ${fmtNum(b.width)} × ${fmtNum(b.height)} mm · ${b.drops.length} drops` : 'No selection';
    }
    return `${st.drops} drops · ${st.rows} jet rows · ${fmtNum(st.inkArea)} mm² ink`;
  }, [selection, pattern, st]);

  return (
    <div className={`app platform-${window.patterner?.platform ?? 'web'}`}>
      <Toolbar
        fileName={file?.name ?? null}
        filePath={file?.path ?? null}
        dirty={dirty}
        mode={mode}
        setMode={setMode}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        snap={snap}
        setSnap={setSnap}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
        onUndo={hist.undo}
        onRedo={hist.redo}
        onNew={() => setShowTemplate(true)}
        onOpen={() => void openDialog()}
        onSave={() => void save(false)}
        onSaveAs={() => void save(true)}
        onExportSvg={() => void exportSvg()}
        onHelp={() => setShowHelp(true)}
        recents={recents}
        onOpenRecent={(p) => void openPath(p)}
      />

      <div className="main">
        <Sidebar
          pattern={pattern}
          selection={selection}
          onSelect={setSelection}
          updateGeneral={updateGeneral}
          updateBlock={updateBlock}
          addBlock={addBlock}
          addDrop={addDrop}
          deleteDrop={deleteDrop}
          deleteBlock={deleteBlock}
          fitPrintArea={fitPrintArea}
          snap={snap}
          setSnap={setSnap}
          snapStep={effectiveSnapStep}
          setSnapStep={setSnapStep}
          snapFeatures={snapFeatures}
          setSnapFeatures={setSnapFeatures}
        />

        <Canvas
          pattern={pattern}
          selection={selection}
          onSelect={setSelection}
          view={view}
          setView={setView}
          mode={mode}
          showGrid={showGrid}
          snap={snap}
          onSize={handleSize}
          beginEdit={hist.snapshot}
          editDrop={updateDrop}
          svgRef={svgRef}
          onFit={fitView}
          snapStep={effectiveSnapStep}
          snapFeatures={snapFeatures}
          onCursorMove={handleCursorMove}
          createDrop={createDrop}
          moveDrops={moveDrops}
        />

        <Inspector
          pattern={pattern}
          selection={selection}
          updateGeneral={updateGeneral}
          updateBlock={updateBlock}
          updateDrop={updateDrop}
          fitPrintArea={fitPrintArea}
          onShowXml={() => setShowXml(true)}
          onExportSvg={() => void exportSvg()}
          onOpenLibrary={() => setShowLibrary(true)}
          onImportSvg={() => void openSvg()}
        />
      </div>

      <footer className="statusbar">
        <span className="seg">
          <b>{file?.name ?? 'Untitled'}</b>
        </span>
        <span className="seg">{selInfo}</span>
        <span className="grow" />
        <span className="seg">
          jet <b>{fmtNum(pattern.general.jetSpacing)} µm</b>
        </span>
        <span className="seg">
          layers <b>{st.layers}</b>
        </span>
        <span className="seg">
          zoom <b>{zoomLabel(view.scale)}</b>
        </span>
        <span className="seg" style={{ color: 'var(--faint)' }}>
          {mode === 'raster' ? 'print raster' : 'design geometry'}
        </span>
      </footer>

      {showTemplate && <TemplateDialog onClose={() => setShowTemplate(false)} onCreate={newFromTemplate} />}
      {showXml && (
        <XmlDialog xml={xml} name={file?.name ?? 'untitled.ptn'} onClose={() => setShowXml(false)} />
      )}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showLibrary && (
        <LibraryDialog
          currentXml={xml}
          currentName={file?.name ?? patternFileName(pattern)}
          onClose={() => setShowLibrary(false)}
          onLoad={(text, name) => {
            setShowLibrary(false);
            loadXml(text, null);
            say(`Loaded ${name} from the library`);
          }}
        />
      )}
      {importFile && (
        <ImportDialog
          svg={importFile.svg}
          fileName={importFile.name}
          onClose={() => setImportFile(null)}
          onCreate={adoptSvg}
        />
      )}

      {dropping && (
        <div className="drop-overlay">
          <div>
            {Icon.folder}
            <span>Drop a .ptn pattern to open it</span>
          </div>
        </div>
      )}

      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
