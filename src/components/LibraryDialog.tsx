import { useEffect, useState } from 'react';
import { Icon, Modal } from './ui';

type Entry = { name: string; file: string; mtime: number; size: number };

type Props = {
  currentXml: string;
  currentName: string;
  onClose: () => void;
  onLoad: (xml: string, name: string) => void;
};

export default function LibraryDialog({ currentXml, currentName, onClose, onLoad }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dir, setDir] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(currentName.replace(/\.ptn$/i, ''));
  const [status, setStatus] = useState<string | null>(null);

  const api = window.patterner;

  const refresh = async () => {
    if (!api) return;
    const res = await api.listLibrary();
    setEntries(res.entries ?? []);
    setDir(res.dir ?? '');
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = Object.keys(selected).filter((k) => selected[k]);

  const saveCurrent = async () => {
    if (!api) return;
    const res = await api.saveToLibrary({ name: name || 'pattern', xml: currentXml });
    setStatus(res.ok ? `Saved “${res.name}” to the library` : res.error ?? 'Could not save');
    await refresh();
  };

  const copy = async (names: string[]) => {
    if (!api || names.length === 0) return;
    const res = await api.copyFromLibrary({ names });
    if (res.canceled) return;
    setStatus(
      res.failed && res.failed.length
        ? `Copied ${res.copied?.length ?? 0}, failed ${res.failed.length}`
        : `Copied ${res.copied?.length ?? 0} file(s) to ${res.dir}`,
    );
    setSelected({});
  };

  return (
    <Modal
      title="Pattern library"
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{dir}</span>
          <button className="btn" onClick={() => void api?.revealLibrary()}>
            {Icon.folder} Reveal folder
          </button>
          <button className="btn" disabled={chosen.length === 0} onClick={() => void copy(chosen)}>
            Copy selected to folder…
          </button>
          <button className="btn primary" disabled={entries.length === 0} onClick={() => void copy(entries.map((e) => e.name))}>
            Copy all to folder…
          </button>
        </>
      }
    >
      <div className="lib-save">
        <span className="lib-label">Save this pattern</span>
        <input
          className="txt"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
          style={{ maxWidth: 280 }}
        />
        <button className="btn primary" onClick={() => void saveCurrent()} disabled={!api}>
          {Icon.save} Save to library
        </button>
      </div>
      {status && <div className="lib-status">{status}</div>}

      <div className="lib-list">
        {entries.length === 0 && <div className="empty-note">Nothing saved yet — patterns live in the app’s library folder.</div>}
        {entries.map((e) => (
          <div key={e.name} className="lib-row">
            <input
              type="checkbox"
              checked={!!selected[e.name]}
              onChange={(ev) => setSelected((s) => ({ ...s, [e.name]: ev.target.checked }))}
            />
            <div className="lib-main">
              <div className="lib-name">{e.name}</div>
              <div className="lib-meta">
                {(e.size / 1024).toFixed(1)} kB · {new Date(e.mtime).toLocaleString()}
              </div>
            </div>
            <button
              className="btn sm"
              onClick={async () => {
                if (!api) return;
                const res = await api.readFromLibrary(e.name);
                if (res.ok && res.xml) onLoad(res.xml, `${e.name}.ptn`);
                else setStatus(res.error ?? 'Could not read');
              }}
            >
              Open
            </button>
            <button className="btn sm" onClick={() => void copy([e.name])}>
              Copy to…
            </button>
            <button
              className="icon-btn"
              title="Delete from library"
              onClick={async () => {
                if (!api) return;
                if (!window.confirm(`Delete “${e.name}” from the library?`)) return;
                await api.deleteFromLibrary(e.name);
                await refresh();
              }}
            >
              {Icon.trash}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
