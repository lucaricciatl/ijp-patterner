/*
 * .ptn — "Standalone Deposition Materials Printer" pattern files.
 *
 * The format is a single-line XML document:
 *
 *   <?xml version="1.0"?><!--Standalone Deposition Materials Printer Pattern File-->
 *   <PatternFile>
 *     <GeneralConfig>       print area + machine settings
 *     <PatternBlock>        a tile of drops (can be repeated MaxX/MaxY times)
 *       <Drop>              one rectangle of deposited material
 *
 * Units are millimetres everywhere EXCEPT JetSpacing, which is micrometres.
 * The print area is always exactly the block bounding box grown by one jet
 * pitch:  Width = max(Left+Width) + JetSpacing/1000, same for Height.
 * (Verified against all 41 sample files, within float32 epsilon.)
 */

export type Drop = {
  startX: number;
  startY: number;
  xWidth: number;
  yHeight: number;
  extra?: Array<[string, string]>;
};

export type PatternBlock = {
  left: number;
  top: number;
  width: number;
  height: number;
  xSpacing: number;
  ySpacing: number;
  maxXCount: number;
  maxYCount: number;
  drops: Drop[];
  extra?: Array<[string, string]>;
};

export type GeneralConfig = {
  left: number;
  top: number;
  width: number;
  height: number;
  useReferenceCoordinates: boolean;
  xReference: number;
  yReference: number;
  xReferenceTile: number;
  yReferenceTile: number;
  useLeaderBar: boolean;
  leaderBarWidth: number;
  leaderBarGap: number;
  /** micrometres between adjacent jets — the machine raster pitch */
  jetSpacing: number;
  layerCount: number;
  layerDelayInSeconds: number;
  extra?: Array<[string, string]>;
};

export type Pattern = {
  general: GeneralConfig;
  blocks: PatternBlock[];
  /** verbatim numeric text keyed by field path, so untouched fields round-trip byte-exactly */
  raw: Record<string, string>;
  extra?: Array<[string, string]>;
};

/* ------------------------------------------------------------------ XML --- */

type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function findTagEnd(src: string, from: number): number {
  let q: string | null = null;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '>') {
      return i;
    }
  }
  return src.length;
}

function parseTag(body: string): { name: string; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  const nameMatch = /^\s*([^\s/>]+)/.exec(body);
  const name = nameMatch ? nameMatch[1] : '';
  const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(body))) {
    attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return { name, attrs };
}

/** Minimal, dependency-free XML reader for this flat document format. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }

    const gt = findTagEnd(src, lt);

    if (src[lt + 1] === '/') {
      if (stack.length > 1) stack.pop();
      i = gt + 1;
      continue;
    }

    const inner = src.slice(lt + 1, gt);
    const selfClosing = inner.trimEnd().endsWith('/');
    const { name, attrs } = parseTag(selfClosing ? inner.trimEnd().slice(0, -1) : inner);
    const node: XmlNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  const doc = root.children.find((c) => c.name === 'PatternFile') ?? root.children[0];
  if (!doc) throw new Error('Not a pattern file: no root element found');
  return doc;
}

const num = (n: XmlNode | undefined, fallback = 0): number => {
  if (!n || n.text.trim() === '') return fallback;
  const v = Number(n.text.trim());
  return Number.isFinite(v) ? v : fallback;
};

const bool = (n: XmlNode | undefined, fallback = false): boolean => {
  if (!n) return fallback;
  const t = n.text.trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  return fallback;
};

const KNOWN_GENERAL = new Set([
  'Left', 'Top', 'Width', 'Height', 'UseReferenceCoordinates', 'XReference',
  'YReference', 'XReferenceTile', 'YReferenceTile', 'UseLeaderBar',
  'LeaderBarWidth', 'LeaderBarGap', 'JetSpacing', 'LayerCount', 'LayerDelayInSeconds',
]);
const KNOWN_BLOCK = new Set([
  'Left', 'Top', 'Width', 'Height', 'XSpacing', 'YSpacing', 'MaxXCount', 'MaxYCount', 'Drop',
]);
const KNOWN_DROP = new Set(['StartX', 'StartY', 'XWidth', 'YHeight']);

function collectUnknown(node: XmlNode, known: Set<string>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const c of node.children) {
    if (known.has(c.name)) continue;
    out.push([c.name, c.text.trim()]);
  }
  return out;
}

export function parsePattern(src: string): Pattern {
  const doc = parseXml(src);
  const gc = doc.children.find((c) => c.name === 'GeneralConfig');
  const raw: Record<string, string> = {};

  const readNum = (node: XmlNode | undefined, path: string, fallback = 0): number => {
    if (node) raw[path] = node.text.trim();
    return num(node, fallback);
  };
  const readBool = (node: XmlNode | undefined, path: string, fallback = false): boolean => {
    if (node) raw[path] = node.text.trim();
    return bool(node, fallback);
  };
  const child = (node: XmlNode | undefined, name: string) =>
    node ? node.children.find((c) => c.name === name) : undefined;

  const general: GeneralConfig = {
    left: readNum(child(gc, 'Left'), 'general.left'),
    top: readNum(child(gc, 'Top'), 'general.top'),
    width: readNum(child(gc, 'Width'), 'general.width'),
    height: readNum(child(gc, 'Height'), 'general.height'),
    useReferenceCoordinates: readBool(child(gc, 'UseReferenceCoordinates'), 'general.useReferenceCoordinates'),
    xReference: readNum(child(gc, 'XReference'), 'general.xReference'),
    yReference: readNum(child(gc, 'YReference'), 'general.yReference'),
    xReferenceTile: readNum(child(gc, 'XReferenceTile'), 'general.xReferenceTile'),
    yReferenceTile: readNum(child(gc, 'YReferenceTile'), 'general.yReferenceTile'),
    useLeaderBar: readBool(child(gc, 'UseLeaderBar'), 'general.useLeaderBar'),
    leaderBarWidth: readNum(child(gc, 'LeaderBarWidth'), 'general.leaderBarWidth'),
    leaderBarGap: readNum(child(gc, 'LeaderBarGap'), 'general.leaderBarGap'),
    jetSpacing: readNum(child(gc, 'JetSpacing'), 'general.jetSpacing', 10),
    layerCount: readNum(child(gc, 'LayerCount'), 'general.layerCount', 1),
    layerDelayInSeconds: readNum(child(gc, 'LayerDelayInSeconds'), 'general.layerDelayInSeconds'),
    extra: gc ? collectUnknown(gc, KNOWN_GENERAL) : [],
  };

  const blocks: PatternBlock[] = doc.children
    .filter((c) => c.name === 'PatternBlock')
    .map((bn, bi) => {
      const bp = `block.${bi}`;
      const drops: Drop[] = bn.children
        .filter((c) => c.name === 'Drop')
        .map((dn, di) => {
          const dp = `${bp}.drop.${di}`;
          return {
            startX: readNum(child(dn, 'StartX'), `${dp}.startX`),
            startY: readNum(child(dn, 'StartY'), `${dp}.startY`),
            xWidth: readNum(child(dn, 'XWidth'), `${dp}.xWidth`),
            yHeight: readNum(child(dn, 'YHeight'), `${dp}.yHeight`),
            extra: collectUnknown(dn, KNOWN_DROP),
          };
        });
      return {
        left: readNum(child(bn, 'Left'), `${bp}.left`),
        top: readNum(child(bn, 'Top'), `${bp}.top`),
        width: readNum(child(bn, 'Width'), `${bp}.width`),
        height: readNum(child(bn, 'Height'), `${bp}.height`),
        xSpacing: readNum(child(bn, 'XSpacing'), `${bp}.xSpacing`),
        ySpacing: readNum(child(bn, 'YSpacing'), `${bp}.ySpacing`),
        maxXCount: readNum(child(bn, 'MaxXCount'), `${bp}.maxXCount`, 1),
        maxYCount: readNum(child(bn, 'MaxYCount'), `${bp}.maxYCount`, 1),
        drops,
        extra: collectUnknown(bn, KNOWN_BLOCK),
      };
    });

  return { general, blocks, raw, extra: collectUnknown(doc, new Set(['GeneralConfig', 'PatternBlock'])) };
}

/* ------------------------------------------------------------- numbers --- */

/** Shortest sane decimal text for a value; never exponential. */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) === 0) return '0';
  let s = String(v);
  if (s.includes('e') || s.includes('E')) s = v.toFixed(12);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** Display formatter: 6 decimals (1 nm) is far below printer resolution, and hides
 *  the float32 noise the vendor software writes (19.0100002288818 → 19.01). */
export function fmtMm(v: number): string {
  return fmtNum(Number(v.toFixed(6)));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function extras(list: Array<[string, string]> | undefined): string {
  if (!list || list.length === 0) return '';
  return list.map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('');
}

/* ----------------------------------------------------------- serializer --- */

export function serializePattern(p: Pattern): string {
  const g = p.general;

  const n = (v: number, path: string): string => {
    const r = p.raw[path];
    if (r !== undefined && Number(r) === v) return r;
    return fmtNum(v);
  };
  const b = (v: boolean, path: string): string => {
    const r = p.raw[path];
    if (r !== undefined && (r === 'True' || r === 'False')) return (r === 'True') === v ? r : v ? 'True' : 'False';
    return v ? 'True' : 'False';
  };

  let out =
    '<?xml version="1.0"?><!--Standalone Deposition Materials Printer Pattern File--><PatternFile>';

  out += '<GeneralConfig>';
  out += `<Left>${n(g.left, 'general.left')}</Left>`;
  out += `<Top>${n(g.top, 'general.top')}</Top>`;
  out += `<Width>${n(g.width, 'general.width')}</Width>`;
  out += `<Height>${n(g.height, 'general.height')}</Height>`;
  out += `<UseReferenceCoordinates>${b(g.useReferenceCoordinates, 'general.useReferenceCoordinates')}</UseReferenceCoordinates>`;
  out += `<XReference>${n(g.xReference, 'general.xReference')}</XReference>`;
  out += `<YReference>${n(g.yReference, 'general.yReference')}</YReference>`;
  out += `<XReferenceTile>${n(g.xReferenceTile, 'general.xReferenceTile')}</XReferenceTile>`;
  out += `<YReferenceTile>${n(g.yReferenceTile, 'general.yReferenceTile')}</YReferenceTile>`;
  out += `<UseLeaderBar>${b(g.useLeaderBar, 'general.useLeaderBar')}</UseLeaderBar>`;
  out += `<LeaderBarWidth>${n(g.leaderBarWidth, 'general.leaderBarWidth')}</LeaderBarWidth>`;
  out += `<LeaderBarGap>${n(g.leaderBarGap, 'general.leaderBarGap')}</LeaderBarGap>`;
  out += `<JetSpacing>${n(g.jetSpacing, 'general.jetSpacing')}</JetSpacing>`;
  out += `<LayerCount>${n(g.layerCount, 'general.layerCount')}</LayerCount>`;
  out += `<LayerDelayInSeconds>${n(g.layerDelayInSeconds, 'general.layerDelayInSeconds')}</LayerDelayInSeconds>`;
  out += extras(g.extra);
  out += '</GeneralConfig>';

  p.blocks.forEach((blk, bi) => {
    const bp = `block.${bi}`;
    out += '<PatternBlock>';
    out += `<Left>${n(blk.left, `${bp}.left`)}</Left>`;
    out += `<Top>${n(blk.top, `${bp}.top`)}</Top>`;
    out += `<Width>${n(blk.width, `${bp}.width`)}</Width>`;
    out += `<Height>${n(blk.height, `${bp}.height`)}</Height>`;
    out += `<XSpacing>${n(blk.xSpacing, `${bp}.xSpacing`)}</XSpacing>`;
    out += `<YSpacing>${n(blk.ySpacing, `${bp}.ySpacing`)}</YSpacing>`;
    out += `<MaxXCount>${n(blk.maxXCount, `${bp}.maxXCount`)}</MaxXCount>`;
    out += `<MaxYCount>${n(blk.maxYCount, `${bp}.maxYCount`)}</MaxYCount>`;
    blk.drops.forEach((d, di) => {
      const dp = `${bp}.drop.${di}`;
      out += '<Drop>';
      out += `<StartX>${n(d.startX, `${dp}.startX`)}</StartX>`;
      out += `<StartY>${n(d.startY, `${dp}.startY`)}</StartY>`;
      out += `<XWidth>${n(d.xWidth, `${dp}.xWidth`)}</XWidth>`;
      out += `<YHeight>${n(d.yHeight, `${dp}.yHeight`)}</YHeight>`;
      out += extras(d.extra);
      out += '</Drop>';
    });
    out += extras(blk.extra);
    out += '</PatternBlock>';
  });

  out += extras(p.extra);
  out += '</PatternFile>';
  return out;
}

/* ---------------------------------------------------------------- misc --- */

/** Default print area of the machine, in millimetres. */
export const STAGE_MM = { width: 200, height: 200 };

export function emptyPattern(jetSpacing = 10): Pattern {
  // the vendor convention is print area = pattern block + one jet pitch, so a
  // 200 x 200 mm area means a block that is one pitch smaller on each axis
  const pitch = jetSpacing / 1000;
  const bw = Number((STAGE_MM.width - pitch).toFixed(6));
  const bh = Number((STAGE_MM.height - pitch).toFixed(6));
  return {
    general: {
      left: 0,
      top: 0,
      width: STAGE_MM.width,
      height: STAGE_MM.height,
      useReferenceCoordinates: false,
      xReference: 0,
      yReference: 0,
      xReferenceTile: 0,
      yReferenceTile: 0,
      useLeaderBar: false,
      leaderBarWidth: 2,
      leaderBarGap: 2,
      jetSpacing,
      layerCount: 1,
      layerDelayInSeconds: 0,
      extra: [],
    },
    blocks: [
      {
        left: 0,
        top: 0,
        width: bw,
        height: bh,
        xSpacing: bw,
        ySpacing: bh,
        maxXCount: 1,
        maxYCount: 1,
        drops: [{ startX: 0, startY: 0, xWidth: bw, yHeight: bh, extra: [] }],
        extra: [],
      },
    ],
    raw: {},
    extra: [],
  };
}

export function patternFileName(p: Pattern): string {
  const g = p.general;
  const first = p.blocks[0]?.drops[0];
  const dims = first ? `${fmtNum(first.xWidth)}x${fmtNum(first.yHeight)}mm` : 'pattern';
  return `ds${g.jetSpacing}_${dims}.ptn`.replace(/\s+/g, '_');
}
