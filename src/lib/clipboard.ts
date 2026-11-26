export type ClipDrop = { startX: number; startY: number; xWidth: number; yHeight: number };

export type Clip =
  | { kind: 'drops'; drops: ClipDrop[] }
  | { kind: 'block'; left: number; top: number; width: number; height: number; drops: ClipDrop[] };

const MARK = 'PTN-CLIP-V1:';

export function encodeClip(c: Clip): string {
  return MARK + JSON.stringify(c);
}

const pick = (d: ClipDrop): ClipDrop => ({
  startX: d.startX,
  startY: d.startY,
  xWidth: d.xWidth,
  yHeight: d.yHeight,
});

/**
 * Accepts our own marker payload, or raw <Drop> XML (e.g. copied out of the
 * XML view or from another pattern file).
 */
export function parseClip(text: string): Clip | null {
  const t = text.trim();
  if (!t) return null;

  if (t.startsWith(MARK)) {
    try {
      const o = JSON.parse(t.slice(MARK.length)) as Clip;
      if (o && Array.isArray(o.drops) && o.drops.length > 0) {
        return { ...o, drops: o.drops.map(pick) };
      }
    } catch {
      /* fall through to XML */
    }
  }

  const drops: ClipDrop[] = [];
  for (const m of t.matchAll(/<Drop>([\s\S]*?)<\/Drop>/g)) {
    const body = m[1];
    const num = (tag: string) => {
      const hit = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(body);
      return hit ? Number(hit[1]) : NaN;
    };
    const d = { startX: num('StartX'), startY: num('StartY'), xWidth: num('XWidth'), yHeight: num('YHeight') };
    if ([d.startX, d.startY, d.xWidth, d.yHeight].every((v) => Number.isFinite(v))) drops.push(d);
  }
  if (drops.length) return { kind: 'drops', drops };

  return null;
}

export function clipBounds(c: Clip): { x: number; y: number; w: number; h: number } {
  const x = Math.min(...c.drops.map((d) => d.startX));
  const y = Math.min(...c.drops.map((d) => d.startY));
  const r = Math.max(...c.drops.map((d) => d.startX + d.xWidth));
  const b = Math.max(...c.drops.map((d) => d.startY + d.yHeight));
  return { x, y, w: r - x, h: b - y };
}
