import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtNum } from '../lib/ptn';

/* ---------------------------------------------------------------- icons --- */

const icon = (d: string, extra?: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {extra}
  </svg>
);

export const Icon = {
  folder: icon('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  save: icon('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM7 3v6h9M8 21v-7h8v7'),
  plus: icon('M12 5v14M5 12h14'),
  minus: icon('M5 12h14'),
  trash: icon('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6'),
  copy: icon('M9 9h10v12H9zM5 15V3h10v2'),
  fit: icon('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  grid: icon('M3 9h18M3 15h18M9 3v18M15 3v18'),
  raster: icon('M3 6h18M3 10h18M3 14h18M3 18h18'),
  chevron: icon('M6 9l6 6 6-6'),
  close: icon('M6 6l12 12M18 6L6 18'),
  code: icon('M8 6l-5 6 5 6M16 6l5 6-5 6'),
  info: icon('M12 8h.01M11 12h1v5h1'),
  bolt: icon('M13 2L4.5 13H11l-1 9 8.5-11H12z'),
  layersIco: icon('M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5'),
  help: icon('M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7v.5M12 17h.01'),
};

/* ------------------------------------------------------------ numeric --- */

/** display/commit precision: 6 decimals = 1 nm, enough for any mm value */
const round6 = (v: number) => Number(v.toFixed(6));

type NumFieldProps = {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  title?: string;
};

export function NumField({ label, value, unit, step = 0.001, disabled, onChange, title }: NumFieldProps) {
  const [text, setText] = useState(() => fmtNum(round6(value)));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) setText(fmtNum(round6(value)));
  }, [value, focused]);

  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (!Number.isFinite(v)) {
      setText(fmtNum(round6(value)));
      return;
    }
    const rounded = round6(v);
    if (rounded === round6(value)) {
      // unchanged: do not touch the model (keeps the original file bytes intact)
      setText(fmtNum(rounded));
      return;
    }
    onChange(rounded);
  };

  return (
    <label className="field" title={title}>
      <span className="field-label">
        {label}
        {unit ? <em>{unit}</em> : null}
      </span>
      <input
        ref={inputRef}
        className="num"
        inputMode="decimal"
        spellCheck={false}
        disabled={disabled}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(text);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const base = Number(text) || 0;
            const next = base + (e.key === 'ArrowUp' ? 1 : -1) * step * mult;
            const rounded = Number(next.toFixed(6));
            setText(fmtNum(rounded));
            onChange(rounded);
          }
        }}
      />
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field-stack">
      <span className="field-label">{label}</span>
      <input className="txt" value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : <span />}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Toggle({
  on,
  onClick,
  children,
  title,
}: {
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button type="button" title={title} className={`icon-btn${on ? ' active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <h3 className="section-title">
        {title}
        {hint ? <span className="hint">{hint}</span> : null}
      </h3>
      {children}
    </section>
  );
}

export function KV({ k, v, em }: { k: string; v: ReactNode; em?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v${em ? ' em' : ''}`}>{v}</span>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  narrow,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  narrow?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${narrow ? ' narrow' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            {Icon.close}
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
