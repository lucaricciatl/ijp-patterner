import type { Pattern } from '../lib/ptn';
import { blockInstances, rasterHeight } from '../lib/geometry';

type Opts = {
  background?: string;
  ink?: string;
  area?: string;
  block?: string;
  leader?: string;
  maxWidth?: number;
  padding?: number;
  footer?: string;
};

/**
 * Clean, publication-ready SVG of the pattern (no rulers, no grid, no labels).
 * Used by "Export preview" — separate from the interactive canvas on purpose.
 */
export function patternToSvg(p: Pattern, opts: Opts = {}): string {
  const o = {
    background: '#ffffff',
    ink: '#0f766e',
    area: '#9aa8b4',
    block: '#c3ced8',
    leader: '#b8792a',
    maxWidth: 1600,
    padding: 24,
    ...opts,
  };

  let x0 = 0;
  let y0 = 0;
  let x1 = Math.max(p.general.width, 0.001);
  let y1 = Math.max(p.general.height, 0.001);
  for (const inst of blockInstances(p)) {
    x0 = Math.min(x0, inst.left);
    y0 = Math.min(y0, inst.top);
    x1 = Math.max(x1, inst.left + inst.width);
    y1 = Math.max(y1, inst.top + inst.height);
  }
  const w = Math.max(0.001, x1 - x0);
  const h = Math.max(0.001, y1 - y0);
  const scale = (o.maxWidth - o.padding * 2) / w;
  const W = Math.round(w * scale + o.padding * 2);
  const H = Math.round(h * scale + o.padding * 2);

  const sx = (mm: number) => (o.padding + (mm - x0) * scale).toFixed(3);
  const sy = (mm: number) => (o.padding + (mm - y0) * scale).toFixed(3);
  const sw = (mm: number) => (mm * scale).toFixed(3);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  );
  if (o.background) parts.push(`<rect width="${W}" height="${H}" fill="${o.background}"/>`);

  // print area
  const g = p.general;
  parts.push(
    `<rect x="${sx(g.left)}" y="${sy(g.top)}" width="${sw(g.width)}" height="${sw(g.height)}" fill="none" stroke="${o.area}" stroke-width="1"/>`,
  );

  // leader bar
  if (g.useLeaderBar && g.leaderBarWidth > 0) {
    parts.push(
      `<rect x="${sx(0)}" y="${sy(0)}" width="${sw(g.leaderBarWidth)}" height="${sw(g.height)}" fill="${o.leader}" fill-opacity="0.25" stroke="${o.leader}" stroke-width="0.8" stroke-dasharray="3 2"/>`,
    );
  }

  // block outlines
  for (const inst of blockInstances(p)) {
    if (inst.copyX !== 0 || inst.copyY !== 0) continue;
    parts.push(
      `<rect x="${sx(inst.left)}" y="${sy(inst.top)}" width="${sw(inst.width)}" height="${sw(inst.height)}" fill="none" stroke="${o.block}" stroke-width="0.8" stroke-dasharray="4 3"/>`,
    );
  }

  // ink: geometry plus the jet rows the machine will actually deposit
  for (const inst of blockInstances(p)) {
    for (const d of p.blocks[inst.blockIndex].drops) {
      const hh = Math.max(d.yHeight, rasterHeight(d, p.general.jetSpacing / 1000));
      parts.push(
        `<rect x="${sx(inst.left + d.startX)}" y="${sy(inst.top + d.startY)}" width="${sw(d.xWidth)}" height="${Math.max(
          0.4,
          Number(sw(hh)),
        ).toFixed(3)}" fill="${o.ink}" fill-opacity="0.85"/>`,
      );
    }
  }

  if (o.footer) {
    parts.push(
      `<text x="${o.padding}" y="${H - 6}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#7b8794">${o.footer}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export function svgToPngBase64(svg: string, scale = 2): Promise<{ base64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ base64: canvas.toDataURL('image/png').split(',')[1], width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not rasterise SVG'));
    };
    img.src = url;
  });
}
