import { emptyPattern, type Drop, type Pattern } from './ptn';
import { fittedPrintArea } from './geometry';

export type TemplateId = 'blank' | 'film' | 'fingers' | 'line' | 'stage';

export type TemplateParams = {
  jetSpacing: number;
  layers: number;
  leaderBar: boolean;
  leaderBarWidth: number;
  leaderBarGap: number;
  /* film */
  width: number;
  height: number;
  /* fingers / line */
  fingerCount: number;
  fingerLength: number;
  fingerPitch: number;
  fingerStagger: number;
  fingerThickness: number;
  /* stage */
  stageWidth: number;
  stageHeight: number;
};

export const defaultParams: TemplateParams = {
  jetSpacing: 10,
  layers: 1,
  leaderBar: false,
  leaderBarWidth: 2,
  leaderBarGap: 2,
  width: 200,
  height: 200,
  fingerCount: 4,
  fingerLength: 7.495,
  fingerPitch: 0.3,
  fingerStagger: 2.5,
  fingerThickness: 0.001,
  stageWidth: 200,
  stageHeight: 200,
};

const round = (v: number) => Number(v.toFixed(6));

/** Recompute GeneralConfig.Width/Height from the blocks (+1 jet pitch), keeping raw text for untouched fields. */
export function fitPrintArea(p: Pattern): Pattern {
  const fit = fittedPrintArea(p);
  return {
    ...p,
    raw: { ...p.raw },
    general: { ...p.general, width: fit.width, height: fit.height },
  };
}

function base(p: TemplateParams): Pattern {
  const p0 = emptyPattern(p.jetSpacing);
  return {
    ...p0,
    general: {
      ...p0.general,
      jetSpacing: p.jetSpacing,
      layerCount: p.layers,
      useLeaderBar: p.leaderBar,
      leaderBarWidth: p.leaderBar ? p.leaderBarWidth : 0,
      leaderBarGap: p.leaderBar ? p.leaderBarGap : 0,
    },
    blocks: [],
    raw: {},
    extra: [],
  };
}

function drop(startX: number, startY: number, xWidth: number, yHeight: number): Drop {
  return { startX: round(startX), startY: round(startY), xWidth: round(xWidth), yHeight: round(yHeight), extra: [] };
}

export function buildTemplate(id: TemplateId, t: TemplateParams): Pattern {
  const p = base(t);
  const x0 = t.leaderBar ? t.leaderBarWidth + t.leaderBarGap : 0;

  if (id === 'blank' || id === 'film' || id === 'stage') {
    // the field is the print area, so the block is inset by one jet pitch
    const inset = t.jetSpacing / 1000;
    const w = Math.max(0.001, (id === 'stage' ? t.stageWidth : t.width) - inset);
    const h = Math.max(0.001, (id === 'stage' ? t.stageHeight : t.height) - inset);
    p.blocks = [
      {
        left: round(x0),
        top: 0,
        width: round(w),
        height: round(h),
        xSpacing: round(w),
        ySpacing: round(h),
        maxXCount: 1,
        maxYCount: 1,
        drops: [drop(0, 0, w, h)],
        extra: [],
      },
    ];
    return fitPrintArea(p);
  }

  if (id === 'line') {
    const w = t.fingerLength;
    p.blocks = [
      {
        left: round(x0),
        top: 0,
        width: round(w),
        height: round(t.fingerPitch),
        xSpacing: round(w),
        ySpacing: round(t.fingerPitch),
        maxXCount: 1,
        maxYCount: 1,
        drops: [drop(0, t.fingerPitch / 2, w, t.fingerThickness)],
        extra: [],
      },
    ];
    return fitPrintArea(p);
  }

  // fingers: serpentine interdigitated fingers, alternating x offset
  const n = Math.max(1, Math.round(t.fingerCount));
  const drops: Drop[] = [];
  for (let i = 0; i < n; i++) {
    const shifted = i % 2 === 1;
    drops.push(
      drop(shifted ? t.fingerStagger : 0, i * t.fingerPitch, t.fingerLength, t.fingerThickness),
    );
  }
  const contentW = t.fingerLength + (n > 1 ? t.fingerStagger : 0);
  const margin = Math.max(t.fingerPitch / 2, 0.005);
  const contentH = (n - 1) * t.fingerPitch + t.fingerThickness;
  p.blocks = [
    {
      left: round(x0),
      top: 0,
      width: round(contentW + margin),
      height: round(contentH + 2 * margin),
      xSpacing: round(contentW + margin),
      ySpacing: round(contentH + 2 * margin),
      maxXCount: 1,
      maxYCount: 1,
      drops: drops.map((d) => ({ ...d, startY: round(d.startY + margin), startX: round(d.startX + margin / 2) })),
      extra: [],
    },
  ];
  return fitPrintArea(p);
}

/** Wrap imported geometry (already in mm, origin at 0,0) into a single block. */
export function patternFromDrops(
  drops: Drop[],
  width: number,
  height: number,
  jetSpacing: number,
  layers = 1,
): Pattern {
  const p = emptyPattern(jetSpacing);
  p.general = { ...p.general, jetSpacing, layerCount: layers };
  p.blocks = [
    {
      left: 0,
      top: 0,
      width: round(Math.max(0.001, width)),
      height: round(Math.max(0.001, height)),
      xSpacing: round(Math.max(0.001, width)),
      ySpacing: round(Math.max(0.001, height)),
      maxXCount: 1,
      maxYCount: 1,
      drops: drops.map((d) => ({ ...d, extra: [] })),
      extra: [],
    },
  ];
  p.raw = {};
  return fitPrintArea(p);
}
