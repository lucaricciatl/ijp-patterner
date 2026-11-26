import { useMemo } from 'react';
import type { Drop, GeneralConfig, Pattern, PatternBlock } from '../lib/ptn';
import { fmtMm as fmtNum } from '../lib/ptn';
import { jetPitch, jetRows, stats as computeStats, validate } from '../lib/geometry';
import type { Selection } from './Canvas';
import { Icon, KV, NumField, Section, Switch } from './ui';

type Props = {
  pattern: Pattern;
  selection: Selection;
  updateGeneral: (patch: Partial<GeneralConfig>, live?: boolean) => void;
  updateBlock: (bi: number, patch: Partial<PatternBlock>, live?: boolean) => void;
  updateDrop: (bi: number, di: number, patch: Partial<Drop>, live?: boolean) => void;
  fitPrintArea: () => void;
  onShowXml: () => void;
  onExportSvg: () => void;
  onOpenLibrary: () => void;
  onImportSvg: () => void;
};

export default function Inspector({
  pattern,
  selection,
  updateGeneral,
  updateBlock,
  updateDrop,
  fitPrintArea,
  onShowXml,
  onExportSvg,
  onOpenLibrary,
  onImportSvg,
}: Props) {
  const pitch = jetPitch(pattern);
  const issues = useMemo(() => validate(pattern), [pattern]);
  const st = useMemo(() => computeStats(pattern), [pattern]);
  const g = pattern.general;

  const drop =
    selection?.kind === 'drop'
      ? { blk: pattern.blocks[selection.bi], d: pattern.blocks[selection.bi]?.drops[selection.di], bi: selection.bi, di: selection.di }
      : null;
  const blk = selection?.kind === 'block' ? { blk: pattern.blocks[selection.bi], bi: selection.bi } : null;
  const multi = selection?.kind === 'drops' ? selection.items : null;

  const multiInfo = useMemo(() => {
    if (!multi || multi.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let rows = 0;
    let area = 0;
    let count = 0;
    for (const r of multi) {
      const b = pattern.blocks[r.bi];
      const d = b?.drops[r.di];
      if (!b || !d) continue;
      count++;
      const x = b.left + d.startX;
      const y = b.top + d.startY;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + d.xWidth);
      maxY = Math.max(maxY, y + Math.max(d.yHeight, pitch));
      rows += jetRows(d, pitch);
      area += d.xWidth * (d.yHeight || pitch);
    }
    if (count === 0) return null;
    return { count, minX, minY, maxX, maxY, rows, area };
  }, [multi, pattern, pitch]);

  return (
    <div className="panel right">
      <div className="scroll">
        {drop && drop.d && drop.blk && (
          <Section title={`Drop ${drop.di + 1}`} hint={`block ${drop.bi + 1}`}>
            <div className="grid2">
              <NumField label="Start X" unit="mm" value={drop.d.startX} step={0.1}
                onChange={(v) => updateDrop(drop.bi, drop.di, { startX: v })} />
              <NumField label="Start Y" unit="mm" value={drop.d.startY} step={0.1}
                onChange={(v) => updateDrop(drop.bi, drop.di, { startY: v })} />
              <NumField label="Width" unit="mm" value={drop.d.xWidth} step={0.1}
                onChange={(v) => updateDrop(drop.bi, drop.di, { xWidth: v })} />
              <NumField label="Height" unit="mm" value={drop.d.yHeight} step={0.001}
                onChange={(v) => updateDrop(drop.bi, drop.di, { yHeight: v })} />
            </div>
            <div className="divider" />
            <KV k="Absolute X" v={`${fmtNum(drop.blk.left + drop.d.startX)} mm`} />
            <KV k="Absolute Y" v={`${fmtNum(drop.blk.top + drop.d.startY)} mm`} />
            <KV k="Jet rows" v={`${jetRows(drop.d, pitch)} × ${fmtNum(g.jetSpacing)} µm`} em />
            <KV k="Printed height" v={`${fmtNum(jetRows(drop.d, pitch) * pitch * 1000)} µm`} />
            <KV k="Area" v={`${fmtNum(drop.d.xWidth * (drop.d.yHeight || pitch))} mm²`} />
            {drop.d.yHeight < pitch && (
              <p className="note">
                Thinner than one jet — the machine prints a single {fmtNum(g.jetSpacing)} µm row.
              </p>
            )}
          </Section>
        )}

        {blk && blk.blk && (
          <Section title={`Block ${blk.bi + 1}`} hint={`${blk.blk.drops.length} drops`}>
            <div className="grid2">
              <NumField label="Left" unit="mm" value={blk.blk.left} step={0.1}
                onChange={(v) => updateBlock(blk.bi, { left: v })} />
              <NumField label="Top" unit="mm" value={blk.blk.top} step={0.1}
                onChange={(v) => updateBlock(blk.bi, { top: v })} />
              <NumField label="Width" unit="mm" value={blk.blk.width} step={0.1}
                onChange={(v) => updateBlock(blk.bi, { width: v })} />
              <NumField label="Height" unit="mm" value={blk.blk.height} step={0.1}
                onChange={(v) => updateBlock(blk.bi, { height: v })} />
            </div>
            <div className="divider" />
            <KV k="Copies" v={`${Math.round(blk.blk.maxXCount) || 1} × ${Math.round(blk.blk.maxYCount) || 1}`} />
            <KV k="Right edge" v={`${fmtNum(blk.blk.left + blk.blk.width)} mm`} />
            <KV k="Bottom edge" v={`${fmtNum(blk.blk.top + blk.blk.height)} mm`} />
          </Section>
        )}

        {multiInfo && (
          <Section title={`${multiInfo.count} drops selected`} hint="⇧-click adds / removes">
            <KV k="Bounding box" v={`${fmtNum(multiInfo.maxX - multiInfo.minX)} × ${fmtNum(multiInfo.maxY - multiInfo.minY)} mm`} />
            <KV k="Top-left" v={`${fmtNum(multiInfo.minX)}, ${fmtNum(multiInfo.minY)} mm`} />
            <KV k="Jet rows" v={`${multiInfo.rows}`} em />
            <KV k="Area" v={`${multiInfo.area.toFixed(4)} mm²`} />
            <p className="note">
              Drag any selected drop to move the whole group; ⌘C, ⌘D and Delete act on all of them. ⇧-drag on empty
              block space draws a selection box.
            </p>
          </Section>
        )}

        {!drop && !blk && !multiInfo && (
          <Section title="Pattern" hint={pattern.blocks.length ? `${pattern.blocks.length} block(s)` : 'empty'}>
            <KV k="Print area" v={`${fmtNum(g.width)} × ${fmtNum(g.height)} mm`} />
            <KV k="Jet spacing" v={`${fmtNum(g.jetSpacing)} µm`} />
            <KV k="Layers" v={`${Math.max(1, Math.round(g.layerCount || 1))}`} />
            <KV k="Drops" v={`${st.drops}`} />
            <KV k="Jet rows" v={`${st.rows}`} em />
            <KV k="Ink area" v={`${st.inkArea.toFixed(3)} mm²`} />
            <KV k="Coverage" v={`${(st.coverage * 100).toFixed(1)} %`} />
          </Section>
        )}

        <Section title="Reference coordinates">
          <Switch
            label="Use reference"
            checked={g.useReferenceCoordinates}
            onChange={(v) => updateGeneral({ useReferenceCoordinates: v })}
          />
          {g.useReferenceCoordinates && (
            <div className="grid2" style={{ marginTop: 6 }}>
              <NumField label="X ref" value={g.xReference} step={0.1} onChange={(v) => updateGeneral({ xReference: v })} />
              <NumField label="Y ref" value={g.yReference} step={0.1} onChange={(v) => updateGeneral({ yReference: v })} />
              <NumField label="X tile" value={g.xReferenceTile} step={1} onChange={(v) => updateGeneral({ xReferenceTile: v })} />
              <NumField label="Y tile" value={g.yReferenceTile} step={1} onChange={(v) => updateGeneral({ yReferenceTile: v })} />
            </div>
          )}
        </Section>

        <Section title="Checks" hint={issues.length ? `${issues.length}` : 'clean'}>
          {issues.length === 0 ? (
            <div className="ok-line">
              <span className="tick">✓</span> Pattern is valid and ready to save.
            </div>
          ) : (
            <div className="issues">
              {issues.map((iss, i) => (
                <div key={i} className={`issue ${iss.level}`}>
                  <span className="bullet" />
                  <span className="msg">{iss.message}</span>
                  {iss.fix === 'fitPrintArea' && (
                    <button className="fix" onClick={fitPrintArea}>
                      fit
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="File">
          <div className="btn-row">
            <button className="btn wide" onClick={onShowXml}>
              {Icon.code} XML source
            </button>
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn wide" onClick={onExportSvg}>
              {Icon.save} Export preview SVG
            </button>
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn" style={{ flex: 1 }} onClick={onOpenLibrary} title="Saved patterns (⌘L)">
              {Icon.layersIco} Library
            </button>
            <button className="btn" style={{ flex: 1 }} onClick={onImportSvg} title="Import an SVG drawing (⇧⌘I)">
              {Icon.bolt} Import SVG
            </button>
          </div>
          <p className="note" style={{ marginTop: 9 }}>
            Units: millimetres everywhere except JetSpacing (µm). Print area = block extent + 1 jet pitch.
          </p>
        </Section>
      </div>
    </div>
  );
}
