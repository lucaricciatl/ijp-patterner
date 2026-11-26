import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

export type RecentFile = { path: string; name: string };

type Props = {
  fileName: string | null;
  filePath: string | null;
  dirty: boolean;
  mode: 'design' | 'raster';
  setMode: (m: 'design' | 'raster') => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  snap: boolean;
  setSnap: (v: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportSvg: () => void;
  onHelp: () => void;
  recents: RecentFile[];
  onOpenRecent: (path: string) => void;
};

export default function Toolbar(p: Props) {
  const [menu, setMenu] = useState<'recent' | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);

  return (
    <header className="titlebar">
      <div className="brand">
        <span className="glyph">PTN</span>
        IJP Patterner
      </div>

      <div className="doc">
        {p.filePath ? <span className="path">{p.filePath.replace(/^.*\/(?=[^/]+\/[^/]+$)/, '…/')}</span> : <span className="path">unsaved</span>}
        <span className="name">{p.fileName ?? 'Untitled pattern'}</span>
        {p.dirty && <span className="dot" title="Unsaved changes" />}
      </div>

      <div className="actions no-drag">
        <button className="btn primary" onClick={p.onNew} title="New pattern (⌘N)">
          {Icon.plus} New
        </button>
        <button className="btn" onClick={p.onOpen} title="Open .ptn (⌘O)">
          {Icon.folder} Open
        </button>

        <div className="pop-wrap" ref={wrap}>
          <button
            className="icon-btn"
            title="Recent patterns"
            onClick={() => setMenu((m) => (m ? null : 'recent'))}
          >
            {Icon.chevron}
          </button>
          {menu === 'recent' && (
            <div className="popover" style={{ top: 34, left: 0 }}>
              <div className="pop-head">Recent</div>
              {p.recents.length === 0 && <div className="pop-item" style={{ color: 'var(--faint)' }}>No recent files</div>}
              {p.recents.map((r) => (
                <button
                  key={r.path}
                  className="pop-item"
                  onClick={() => {
                    setMenu(null);
                    p.onOpenRecent(r.path);
                  }}
                >
                  <span className="col">
                    <span>{r.name}</span>
                    <span className="path">{r.path}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="btn" onClick={p.onSave} title="Save (⌘S)">
          {Icon.save} Save
        </button>

        <span className="vsep" />

        <button className="icon-btn" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (⌘Z)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
          </svg>
        </button>
        <button className="icon-btn" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (⇧⌘Z)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H10a6 6 0 0 0 0 12h3" />
          </svg>
        </button>
      </div>

      <span className="spacer" />

      <div className="segmented no-drag" title="Design geometry or the machine's print raster">
        <button className={p.mode === 'design' ? 'on' : ''} onClick={() => p.setMode('design')}>
          Design
        </button>
        <button className={p.mode === 'raster' ? 'on' : ''} onClick={() => p.setMode('raster')}>
          Print raster
        </button>
      </div>

      <div className="actions no-drag">
        <button
          className={`icon-btn${p.showGrid ? ' active' : ''}`}
          title="Grid (⌘G)"
          onClick={() => p.setShowGrid(!p.showGrid)}
        >
          {Icon.grid}
        </button>
        <button
          className={`icon-btn${p.snap ? ' active' : ''}`}
          title="Snap to jet rows (hold ⌥ to disable)"
          onClick={() => p.setSnap(!p.snap)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
            <path d="M5 4v10a5 5 0 0 0 5 5h9" />
            <circle cx="5" cy="4" r="1.6" />
            <circle cx="19" cy="19" r="1.6" />
          </svg>
        </button>
        <button className="icon-btn" title="Format reference" onClick={p.onHelp}>
          {Icon.help}
        </button>
      </div>
    </header>
  );
}
