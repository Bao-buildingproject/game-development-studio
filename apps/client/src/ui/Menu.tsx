import { useState } from 'react';
import { useUI } from '../state';
import { useSettings } from '../settings';
import { net } from '../game/network/net';
import { audio } from '../game/audio/audio';

export default function Menu() {
  const { go, error, conn } = useUI();
  const s = useSettings();
  const [busy, setBusy] = useState(false);
  const name = s.name || 'Responder';

  const create = async (solo: boolean) => {
    audio.init();
    setBusy(true);
    const ok = await net.create(name);
    setBusy(false);
    if (!ok) return;
    if (solo) net.start();
    else go('lobby');
  };

  return (
    <div className="screen" style={{ justifyContent: 'flex-start', alignItems: 'flex-start', paddingLeft: '9vw', paddingTop: '6vh', paddingBottom: '4vh', overflowY: 'auto' }}>
      <div className="col" style={{ gap: 26, position: 'relative', zIndex: 2 }}>
        <div>
          <div className="mono muted" style={{ fontSize: 12, letterSpacing: '.3em' }}>PROJECT SYNAPSE · FACILITY B4</div>
          <h1 className="logo" style={{ fontSize: 84, margin: '6px 0 0', lineHeight: 0.95 }}>IT LEARNS</h1>
          <div className="logo" style={{ fontSize: 22, color: 'var(--danger)', letterSpacing: '.4em' }}>THE HUNT</div>
          <p className="muted" style={{ maxWidth: 420, marginTop: 14 }}>The monster learns from your habits. Survival depends on changing them.</p>
        </div>
        <label className="col" style={{ gap: 4, width: 280 }}>
          <span className="muted" style={{ fontSize: 12 }}>Display name</span>
          <input value={s.name} maxLength={16} placeholder="Responder" onChange={(e) => s.set({ name: e.target.value })} />
        </label>
        <div className="col" style={{ gap: 8 }}>
          <button className="btn big primary" disabled={busy} onClick={() => create(true)}>PLAY <span className="muted" style={{ color: '#173033', fontWeight: 400 }}>· solo</span></button>
          <button className="btn big" disabled={busy} onClick={() => create(false)}>CREATE ROOM</button>
          <button className="btn big" onClick={() => go('join')}>JOIN ROOM</button>
          <button className="btn big" onClick={() => go('settings')}>SETTINGS</button>
          <button className="btn big" onClick={() => go('howto')}>HOW TO PLAY</button>
          <button className="btn big" onClick={() => go('credits')}>CREDITS</button>
        </div>
        {conn === 'connecting' && <div className="muted">Connecting to the facility server…</div>}
        {error && <div style={{ color: '#ffb3b8' }}>{error}</div>}
        {!s.seenPointerLockNotice && (
          <div className="panel" style={{ padding: 14, maxWidth: 420, fontSize: 13 }}>
            <b>Mouse look uses Pointer Lock.</b> When the match starts, click the screen and your browser will hide the cursor so the mouse can turn the camera.
            Press <span className="mono">Esc</span> any time to release it and pause.
            <div style={{ marginTop: 8 }}><button className="btn" onClick={() => s.set({ seenPointerLockNotice: true })}>Got it</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
