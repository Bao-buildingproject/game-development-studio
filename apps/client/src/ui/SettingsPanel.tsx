import { useEffect, useState } from 'react';
import { ACTION_LABEL, Action, keyName, useSettings } from '../settings';

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
      <span>{label}</span>
      <span className="row"><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 180 }} /><span className="mono" style={{ width: 44 }}>{fmt ? fmt(value) : value}</span></span>
    </label>
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [rebind, setRebind] = useState<Action | null>(null);
  useEffect(() => {
    if (!rebind) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== 'Escape') s.set({ keys: { ...s.keys, [rebind]: [e.code] } });
      setRebind(null);
    };
    window.addEventListener('keydown', h, { once: true });
    return () => window.removeEventListener('keydown', h);
  }, [rebind]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="panel" style={{ padding: 24, width: 'min(820px, 94vw)', maxHeight: '88vh', overflow: 'auto', position: 'relative', zIndex: 3, pointerEvents: 'auto' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="logo" style={{ margin: 0 }}>SETTINGS</h2>
        <div className="row"><button className="btn" onClick={s.reset}>Reset</button><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 16 }}>
        <div className="col">
          <h4 style={{ margin: 0 }}>Controls & view</h4>
          <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => s.set({ sensitivity: v })} fmt={(v) => v.toFixed(2)} />
          <label className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}><span>Invert Y</span><input type="checkbox" checked={s.invertY} onChange={(e) => s.set({ invertY: e.target.checked })} /></label>
          <Slider label="Field of view" value={s.fov} min={60} max={100} step={1} onChange={(v) => s.set({ fov: v })} />
          <Slider label="Brightness" value={s.brightness} min={0.5} max={2.2} step={0.05} onChange={(v) => s.set({ brightness: v })} fmt={pct} />
          <h4 style={{ margin: '10px 0 0' }}>Audio</h4>
          <Slider label="Master" value={s.master} min={0} max={1} step={0.05} onChange={(v) => s.set({ master: v })} fmt={pct} />
          <Slider label="Effects & creature" value={s.sfx} min={0} max={1} step={0.05} onChange={(v) => s.set({ sfx: v })} fmt={pct} />
          <Slider label="Ambience" value={s.ambience} min={0} max={1} step={0.05} onChange={(v) => s.set({ ambience: v })} fmt={pct} />
          <Slider label="Music" value={s.music} min={0} max={1} step={0.05} onChange={(v) => s.set({ music: v })} fmt={pct} />
          <h4 style={{ margin: '10px 0 0' }}>Accessibility</h4>
          {([['subtitles', 'Subtitles for important sounds'], ['reduceShake', 'Reduce camera shake'], ['reduceScares', 'Reduce strong scares']] as const).map(([k, l]) => (
            <label key={k} className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}><span>{l}</span><input type="checkbox" checked={s[k]} onChange={(e) => s.set({ [k]: e.target.checked })} /></label>
          ))}
          <div className="muted" style={{ fontSize: 12 }}>Voice chat is not part of this MVP – the game is fully playable without it.</div>
        </div>
        <div className="col">
          <h4 style={{ margin: 0 }}>Key bindings</h4>
          {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
            <div key={a} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span>{ACTION_LABEL[a]}</span>
              <button className="btn mono" style={{ padding: '4px 10px', minWidth: 96, borderColor: rebind === a ? 'var(--warn)' : undefined }} onClick={() => setRebind(a)}>
                {rebind === a ? 'press a key…' : s.keys[a].map(keyName).join(' / ')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
