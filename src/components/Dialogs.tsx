import { useState, type ReactNode } from 'react';
import type { TemplateId, TemplateParams } from '../lib/templates';
import { defaultParams } from '../lib/templates';
import { fmtMm as fmtNum } from '../lib/ptn';
import { Modal, NumField, Switch } from './ui';

/* ----------------------------------------------------------- templates --- */

const TPL: Array<{ id: TemplateId; name: string; hint: string; thumb: ReactNode }> = [
  {
    id: 'film',
    name: 'Film',
    hint: 'solid rectangle',
    thumb: (
      <>
        <rect x={6} y={9} width={40} height={16} rx={1.5} fill="#2ee6a8" fillOpacity={0.5} stroke="#2ee6a8" />
      </>
    ),
  },
  {
    id: 'fingers',
    name: 'Fingers',
    hint: 'serpentine lines',
    thumb: (
      <>
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={i % 2 ? 16 : 6}
            x2={i % 2 ? 46 : 36}
            y1={8 + i * 5}
            y2={8 + i * 5}
            stroke="#2ee6a8"
            strokeWidth={1.6}
          />
        ))}
      </>
    ),
  },
  {
    id: 'line',
    name: 'Line',
    hint: 'single hairline',
    thumb: (
      <>
        <line x1={6} y1={17} x2={46} y2={17} stroke="#2ee6a8" strokeWidth={1.6} />
        <line x1={6} y1={22} x2={46} y2={22} stroke="#2ee6a8" strokeOpacity={0.18} strokeDasharray="2 3" />
      </>
    ),
  },
  {
    id: 'stage',
    name: 'Stage',
    hint: 'full print area',
    thumb: (
      <>
        <rect x={4} y={4} width={44} height={26} fill="none" stroke="#3a4f61" strokeDasharray="3 2" />
        <rect x={6} y={6} width={40} height={22} fill="#2ee6a8" fillOpacity={0.45} />
      </>
    ),
  },
  {
    id: 'blank',
    name: 'Blank',
    hint: 'empty block',
    thumb: (
      <>
        <rect x={6} y={8} width={40} height={18} fill="none" stroke="#4a5f71" strokeDasharray="3 3" />
      </>
    ),
  },
];

export function TemplateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (id: TemplateId, params: TemplateParams) => void;
}) {
  const [id, setId] = useState<TemplateId>('film');
  const [p, setP] = useState<TemplateParams>(defaultParams);
  const set = (patch: Partial<TemplateParams>) => setP((prev) => ({ ...prev, ...patch }));

  return (
    <Modal
      title="New pattern"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onCreate(id, p)}>
            Create pattern
          </button>
        </>
      }
    >
      <div className="tpl-grid">
        {TPL.map((t) => (
          <button key={t.id} className={`tpl${id === t.id ? ' on' : ''}`} onClick={() => setId(t.id)}>
            <svg viewBox="0 0 52 34" fill="none">
              {t.thumb}
            </svg>
            <span className="cap">{t.name}</span>
            <span style={{ fontSize: 10, color: 'var(--faint)' }}>{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="tpl-params">
        <div className="param-col">
          <h4>Machine</h4>
          <NumField label="Jet spacing" unit="µm" value={p.jetSpacing} step={5} onChange={(v) => set({ jetSpacing: v })} />
          <NumField label="Layers" value={p.layers} step={1} onChange={(v) => set({ layers: Math.max(1, Math.round(v)) })} />
          <Switch label="Leader bar" checked={p.leaderBar} onChange={(v) => set({ leaderBar: v })} />
          {p.leaderBar && (
            <div className="grid2">
              <NumField label="Bar width" unit="mm" value={p.leaderBarWidth} step={0.5} onChange={(v) => set({ leaderBarWidth: v })} />
              <NumField label="Bar gap" unit="mm" value={p.leaderBarGap} step={0.5} onChange={(v) => set({ leaderBarGap: v })} />
            </div>
          )}
        </div>

        <div className="param-col">
          <h4>Geometry</h4>
          {(id === 'film' || id === 'blank') && (
            <>
              <NumField label="Print width" unit="mm" value={p.width} step={5} onChange={(v) => set({ width: v })} />
              <NumField label="Print height" unit="mm" value={p.height} step={5} onChange={(v) => set({ height: v })} />
            </>
          )}
          {id === 'stage' && (
            <>
              <NumField label="Print width" unit="mm" value={p.stageWidth} step={5} onChange={(v) => set({ stageWidth: v })} />
              <NumField label="Print height" unit="mm" value={p.stageHeight} step={5} onChange={(v) => set({ stageHeight: v })} />
            </>
          )}
          {id === 'line' && (
            <>
              <NumField label="Length" unit="mm" value={p.fingerLength} step={0.5} onChange={(v) => set({ fingerLength: v })} />
              <NumField label="Thickness" unit="mm" value={p.fingerThickness} step={0.001} onChange={(v) => set({ fingerThickness: v })} />
              <NumField label="Row offset" unit="mm" value={p.fingerPitch} step={0.05} onChange={(v) => set({ fingerPitch: v })} />
            </>
          )}
          {id === 'fingers' && (
            <>
              <NumField label="Fingers" value={p.fingerCount} step={1} onChange={(v) => set({ fingerCount: Math.max(1, Math.round(v)) })} />
              <NumField label="Pitch" unit="mm" value={p.fingerPitch} step={0.05} onChange={(v) => set({ fingerPitch: v })} />
              <NumField label="Length" unit="mm" value={p.fingerLength} step={0.1} onChange={(v) => set({ fingerLength: v })} />
              <NumField label="Stagger" unit="mm" value={p.fingerStagger} step={0.1} onChange={(v) => set({ fingerStagger: v })} />
              <NumField label="Thickness" unit="mm" value={p.fingerThickness} step={0.001} onChange={(v) => set({ fingerThickness: v })} />
            </>
          )}
        </div>

        <div className="param-col muted-col">
          <h4>Result</h4>
          <div className="kv">
            <span className="k">Jet pitch</span>
            <span className="v">{fmtNum(p.jetSpacing)} µm</span>
          </div>
          <div className="kv">
            <span className="k">Rows / drop</span>
            <span className="v">
              {id === 'fingers' || id === 'line'
                ? Math.max(1, Math.round(p.fingerThickness / (p.jetSpacing / 1000)))
                : '—'}
            </span>
          </div>
          <div className="kv">
            <span className="k">Layers</span>
            <span className="v">{p.layers}</span>
          </div>
          <p className="note">
            Film and Stage sizes are the print area; the block is inset by one jet pitch so the area lands exactly
            on the number you type.
          </p>
          <p className="note">Fingers alternate x by the stagger, so neighbouring lines interdigitate like a comb.</p>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- XML --- */

export function XmlDialog({ xml, name, onClose }: { xml: string; name: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title="Pattern XML"
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{name}</span>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(xml);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy XML'}
          </button>
        </>
      }
    >
      <pre className="xml">{xml}</pre>
    </Modal>
  );
}

/* --------------------------------------------------------------- help --- */

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How .ptn patterns work" onClose={onClose} narrow={false}>
      <div className="help">
        <p>
          A pattern file is a single-line XML document written by the Standalone Deposition Materials Printer
          software. Everything is in <b>millimetres</b>, except <code>JetSpacing</code> which is in{' '}
          <b>micrometres</b>.
        </p>

        <h3>Structure</h3>
        <table>
          <tbody>
            <tr>
              <th>Element</th>
              <th>Meaning</th>
            </tr>
            <tr>
              <td>&lt;GeneralConfig&gt;</td>
              <td>
                Print area (<code>Left/Top/Width/Height</code>), jet pitch, layer count and leader-bar settings.
              </td>
            </tr>
            <tr>
              <td>&lt;PatternBlock&gt;</td>
              <td>
                A tile with its own origin and size, repeated <code>MaxXCount × MaxYCount</code> times at{' '}
                <code>XSpacing / YSpacing</code>.
              </td>
            </tr>
            <tr>
              <td>&lt;Drop&gt;</td>
              <td>
                One printed rectangle inside a block: <code>StartX, StartY, XWidth, YHeight</code>.
              </td>
            </tr>
          </tbody>
        </table>

        <h3>The two rules that matter</h3>
        <p>
          <b>1 · Print area = blocks + one jet pitch.</b> In every real file{' '}
          <code>Width = max(block.Right) + JetSpacing/1000</code> and the same for the height, so{' '}
          <code>19.01 × 1.215 mm</code> for a 15 mm block on 10 µm jets at x = 4. The editor keeps this in sync
          with <b>fit</b>.
        </p>
        <p>
          <b>2 · The machine prints in rows, not in vector fills.</b> Each drop is rasterised into rows spaced{' '}
          <code>JetSpacing</code> apart; a drop shorter than one jet still gets exactly one row. That is why a{' '}
          <code>0.001 mm</code> "finger" in the sample files is really a single 10 µm line, and why the print
          raster view snaps the design to what the machine can actually deposit.
        </p>

        <h3>Field reference</h3>
        <table>
          <tbody>
            <tr>
              <th>Field</th>
              <th>Unit</th>
              <th>Notes</th>
            </tr>
            <tr>
              <td>Width / Height</td>
              <td className="n">mm</td>
              <td>print area; derived from the blocks</td>
            </tr>
            <tr>
              <td>JetSpacing</td>
              <td className="n">µm</td>
              <td>raster pitch — 5, 10, 15, 20 or 300 µm in the samples</td>
            </tr>
            <tr>
              <td>LayerCount</td>
              <td className="n">—</td>
              <td>how many times the pattern is repeated before curing</td>
            </tr>
            <tr>
              <td>UseLeaderBar</td>
              <td className="n">True/False</td>
              <td>a priming bar at the left edge, then a gap before the pattern</td>
            </tr>
            <tr>
              <td>StartX / StartY</td>
              <td className="n">mm</td>
              <td>drop origin relative to the block origin</td>
            </tr>
            <tr>
              <td>YHeight</td>
              <td className="n">mm</td>
              <td>0 or sub-jet values mean a single row</td>
            </tr>
          </tbody>
        </table>

        <h3>Workflow in this app</h3>
        <p>
          A new pattern opens on the machine's <b>200 × 200 mm</b> print area — a 199.99 × 199.99 mm block on
          10 µm jets, since the area is always one jet pitch larger than the pattern.
        </p>
        <p>
          Open or drop a <code>.ptn</code> file, edit numbers on the left, drag or resize drops on the canvas,
          switch to <b>Print raster</b> to see the deposition as the machine will lay it, then save. Untouched
          values are written back verbatim, so opening and saving a file is byte-identical.
        </p>
        <p>
          <b>Several drops at once:</b> ⇧-click adds or removes a drop from the selection, ⇧-drag draws a
          selection box, and a drag on any selected drop moves the group. <code>⌘C</code>, <code>⌘D</code>,
          <code>Delete</code> and the arrow keys then apply to everything selected. The clipboard is the system
          one, so a copied group can be pasted into another window or another pattern.
        </p>
      </div>
    </Modal>
  );
}
