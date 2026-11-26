import { useMemo, useState } from 'react';
import { defaultImportOptions, importSvg, type SvgImportOptions } from '../lib/svgImport';
import type { Drop } from '../lib/ptn';
import { fmtMm } from '../lib/ptn';
import { Icon, Modal, NumField } from './ui';

type Props = {
  svg: string;
  fileName: string;
  onClose: () => void;
  onCreate: (drops: Drop[], width: number, height: number, jetSpacing: number) => void;
};

export default function ImportDialog({ svg, fileName, onClose, onCreate }: Props) {
  const [jet, setJet] = useState(10);
  const [stroke, setStroke] = useState(defaultImportOptions.strokeMm);
  const [fitWidth, setFitWidth] = useState<number>(0);
  const [scale, setScale] = useState(1);

  const result = useMemo(() => {
    const opts: SvgImportOptions = {
      scale,
      fitWidth: fitWidth > 0 ? fitWidth : null,
      strokeMm: stroke,
      maxDrops: 2000,
    };
    try {
      return { ok: true as const, data: importSvg(svg, opts) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [svg, scale, fitWidth, stroke]);

  const data = result.ok ? result.data : null;

  return (
    <Modal
      title="Import SVG → pattern"
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{fileName}</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!data || data.drops.length === 0}
            onClick={() => data && onCreate(data.drops, data.width, data.height, jet)}
          >
            Create pattern
          </button>
        </>
      }
    >
      {!result.ok && <div className="issue error">{result.error}</div>}

      {data && (
        <>
          <div className="import-stats">
            <div>
              <span className="k">size</span>
              <span className="v">
                {fmtMm(data.width)} × {fmtMm(data.height)} mm
              </span>
            </div>
            <div>
              <span className="k">shapes</span>
              <span className="v">{data.shapes}</span>
            </div>
            <div>
              <span className="k">drops</span>
              <span className="v">{data.drops.length}</span>
            </div>
            <div>
              <span className="k">jet</span>
              <span className="v">{fmtMm(jet)} µm</span>
            </div>
          </div>

          <div className="import-opts">
            <NumField
              label="Fit width"
              unit="mm"
              value={fitWidth}
              step={1}
              onChange={setFitWidth}
              title="Rescale the drawing to this width; 0 keeps SVG units as millimetres"
            />
            <NumField label="Scale" unit="mm/unit" value={scale} step={0.1} onChange={setScale} />
            <NumField label="Stroke" unit="mm" value={stroke} step={0.005} onChange={setStroke} />
            <NumField label="Jet spacing" unit="µm" value={jet} step={5} onChange={setJet} />
          </div>

          <p className="note">
            Rectangles become one drop each. Lines, polylines, paths and circles are sampled along the path and
            become thin drops the width of the stroke. Filled curves cannot be represented by rectangles and are
            reduced to their bounding box.
          </p>

          {data.warnings.length > 0 && (
            <div className="issues" style={{ marginTop: 10 }}>
              {data.warnings.map((w, i) => (
                <div key={i} className="issue warn">
                  <span className="bullet" />
                  <span className="msg">{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="import-preview">
            <svg viewBox={`0 0 ${Math.max(1, data.width)} ${Math.max(1, data.height)}`} preserveAspectRatio="xMidYMid meet">
              {data.drops.slice(0, 400).map((d, i) => (
                <rect
                  key={i}
                  x={d.startX}
                  y={d.startY}
                  width={Math.max(d.xWidth, data.width / 900)}
                  height={Math.max(d.yHeight, data.height / 260)}
                  fill="#2ee6a8"
                  fillOpacity={0.85}
                />
              ))}
            </svg>
            {data.drops.length > 400 && <span className="preview-note">first 400 of {data.drops.length}</span>}
          </div>
          <div className="import-actions">
            <span className="note" style={{ margin: 0 }}>
              {Icon.info} The drawing is placed at the block origin; adjust the block offset afterwards if needed.
            </span>
          </div>
        </>
      )}
    </Modal>
  );
}
