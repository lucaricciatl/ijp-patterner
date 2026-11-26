import type { ReactNode } from 'react';
import type { GeneralConfig, Pattern, PatternBlock } from '../lib/ptn';
import { fmtMm as fmtNum } from '../lib/ptn';
import { isRefSelected, type Selection } from './Canvas';
import { Icon, NumField, Section, Switch } from './ui';

type Props = {
  pattern: Pattern;
  selection: Selection;
  onSelect: (s: Selection) => void;
  updateGeneral: (patch: Partial<GeneralConfig>, live?: boolean) => void;
  updateBlock: (bi: number, patch: Partial<PatternBlock>, live?: boolean) => void;
  addBlock: () => void;
  addDrop: (bi: number) => void;
  deleteDrop: (bi: number, di: number) => void;
  deleteBlock: (bi: number) => void;
  fitPrintArea: () => void;
  snap: boolean;
  setSnap: (v: boolean) => void;
  snapFeatures: boolean;
  setSnapFeatures: (v: boolean) => void;
  snapStep: number;
  setSnapStep: (v: number | null) => void;
};

function Row({
  children,
  onDelete,
  title,
}: {
  children: ReactNode;
  onDelete?: () => void;
  title?: string;
}) {
  return (
    <div className="list-row" title={title}>
      {children}
      {onDelete ? (
        <button
          className="row-x"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          {Icon.trash}
        </button>
      ) : null}
    </div>
  );
}

export default function Sidebar({
  pattern,
  selection,
  onSelect,
  updateGeneral,
  updateBlock,
  addBlock,
  addDrop,
  deleteDrop,
  deleteBlock,
  fitPrintArea,
  snap,
  setSnap,
  snapFeatures,
  setSnapFeatures,
  snapStep,
  setSnapStep,
}: Props) {
  const g = pattern.general;
  const rawActive = selection && 'bi' in selection ? selection.bi : pattern.blocks.length - 1;
  const activeBlock = Math.min(Math.max(0, rawActive), Math.max(0, pattern.blocks.length - 1));
  const activeBlockExists = !!pattern.blocks[activeBlock];

  return (
    <div className="panel left">
      <div className="scroll">
        <Section
          title="Print area"
          hint={
            <button className="link-btn" onClick={fitPrintArea} title="Blocks + one jet pitch">
              fit
            </button>
          }
        >
          <div className="grid2">
            <NumField label="Width" unit="mm" value={g.width} step={0.01} onChange={(v) => updateGeneral({ width: v })} />
            <NumField label="Height" unit="mm" value={g.height} step={0.01} onChange={(v) => updateGeneral({ height: v })} />
            <NumField label="Left" unit="mm" value={g.left} step={0.01} onChange={(v) => updateGeneral({ left: v })} />
            <NumField label="Top" unit="mm" value={g.top} step={0.01} onChange={(v) => updateGeneral({ top: v })} />
          </div>
        </Section>

        <Section title="Jet & layers">
          <NumField
            label="Jet spacing"
            unit="µm"
            value={g.jetSpacing}
            step={1}
            onChange={(v) => updateGeneral({ jetSpacing: v })}
            title="Raster pitch between adjacent jets (JetSpacing)"
          />
          <NumField label="Layers" value={g.layerCount} step={1} onChange={(v) => updateGeneral({ layerCount: v })} />
          <NumField
            label="Layer delay"
            unit="s"
            value={g.layerDelayInSeconds}
            step={1}
            onChange={(v) => updateGeneral({ layerDelayInSeconds: v })}
          />
        </Section>

        <Section
          title="Snapping"
          hint={
            <button className="link-btn" onClick={() => setSnapStep(null)} title="Follow the grid drawn at the current zoom">
              auto
            </button>
          }
        >
          <Switch label="Snap to grid" checked={snap} onChange={setSnap} />
          <div className="grid2" style={{ marginTop: 6 }}>
            <NumField
              label="Grid step"
              unit="mm"
              value={snapStep}
              step={0.005}
              onChange={(v) => setSnapStep(v)}
              title="Rounds dragged edges to this step — “auto” follows the zoom"
            />
          </div>
          <Switch label="Snap to edges" checked={snapFeatures} onChange={setSnapFeatures} />
          <p className="note">Auto = the grid you can see, so a drag lands on a line. Hold ⌥ to drag freely; “edges” also pulls to the block, the print area and other drops’ edges and centres.</p>
        </Section>

        <Section title="Leader bar">
          <Switch
            label="Use leader bar"
            checked={g.useLeaderBar}
            onChange={(v) => updateGeneral({ useLeaderBar: v })}
          />
          {g.useLeaderBar && (
            <div className="grid2" style={{ marginTop: 6 }}>
              <NumField
                label="Width"
                unit="mm"
                value={g.leaderBarWidth}
                step={0.5}
                onChange={(v) => updateGeneral({ leaderBarWidth: v })}
              />
              <NumField
                label="Gap"
                unit="mm"
                value={g.leaderBarGap}
                step={0.5}
                onChange={(v) => updateGeneral({ leaderBarGap: v })}
              />
            </div>
          )}
        </Section>

        <Section
          title="Blocks"
          hint={
            <button className="link-btn" onClick={addBlock}>
              + block
            </button>
          }
        >
          {pattern.blocks.length === 0 && <div className="empty-note">No blocks yet.</div>}
          {pattern.blocks.map((blk, bi) => {
            const blockSel = selection?.kind === 'block' && selection.bi === bi;
            return (
              <div key={bi}>
                <Row onDelete={() => deleteBlock(bi)} title={`Block ${bi + 1}`}>
                  <button
                    className={`item${blockSel ? ' sel' : ''}`}
                    onClick={() => onSelect({ kind: 'block', bi })}
                  >
                    <span className="idx">B{bi + 1}</span>
                    <span className="label">
                      {fmtNum(blk.width)} × {fmtNum(blk.height)} mm
                    </span>
                    <span className="meta">{blk.drops.length}d</span>
                  </button>
                </Row>

                {blk.drops.map((d, di) => {
                  const sel = isRefSelected(selection, bi, di);
                  return (
                    <Row key={di} onDelete={() => deleteDrop(bi, di)}>
                      <button
                        className={`item drop-row${sel ? ' sel' : ''}`}
                        onClick={() => onSelect({ kind: 'drop', bi, di })}
                      >
                        <span className="swatch" />
                        <span className="label">
                          {fmtNum(d.xWidth)} × {fmtNum(d.yHeight)}
                        </span>
                        <span className="meta">
                          {fmtNum(blk.left + d.startX)}, {fmtNum(blk.top + d.startY)}
                        </span>
                      </button>
                    </Row>
                  );
                })}

                <button className="add-drop" onClick={() => addDrop(bi)}>
                  {Icon.plus}
                  drop
                </button>
              </div>
            );
          })}
        </Section>

        {activeBlockExists && (
          <Section title="Tiling" hint={`block ${activeBlock + 1}`}>
            <div className="grid2">
              <NumField
                label="X count"
                value={pattern.blocks[activeBlock].maxXCount}
                step={1}
                onChange={(v) => updateBlock(activeBlock, { maxXCount: Math.max(1, Math.round(v)) })}
              />
              <NumField
                label="Y count"
                value={pattern.blocks[activeBlock].maxYCount}
                step={1}
                onChange={(v) => updateBlock(activeBlock, { maxYCount: Math.max(1, Math.round(v)) })}
              />
              <NumField
                label="Step X"
                unit="mm"
                value={pattern.blocks[activeBlock].xSpacing}
                step={0.5}
                onChange={(v) => updateBlock(activeBlock, { xSpacing: v })}
              />
              <NumField
                label="Step Y"
                unit="mm"
                value={pattern.blocks[activeBlock].ySpacing}
                step={0.5}
                onChange={(v) => updateBlock(activeBlock, { ySpacing: v })}
              />
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
