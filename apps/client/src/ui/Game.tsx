import { useEffect, useRef, useState } from 'react';
import { CHARACTERS, HEALTH_MAX, ITEM_LABEL, MAP_H, MAP_W, STAMINA, ZONES, DOORS, Snapshot } from '@itl/shared';
import { GameEngine } from '../game/renderer/engine';
import { useUI } from '../state';
import { net } from '../game/network/net';
import SettingsPanel from './SettingsPanel';

export default function Game() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<GameEngine | null>(null);
  const ui = useUI();
  useEffect(() => {
    const e = new GameEngine(canvas.current!);
    engine.current = e;
    e.start();
    return () => { e.dispose(); engine.current = null; };
  }, []);
  // Esc always opens the pause menu (also when the browser never granted pointer lock)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const st = useUI.getState();
      if (st.screen !== 'game') return;
      if (st.keypad) st.set({ keypad: false });
      else if (st.doc) st.set({ doc: null });
      else if (st.showMap || st.showInventory) st.set({ showMap: false, showInventory: false });
      else { document.exitPointerLock?.(); st.set({ paused: true }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  // HUD refresh for fading subtitles/notices
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 500); return () => clearInterval(t); }, []);

  const s = ui.hud;
  const me = s?.players.find((p) => p.id === ui.sessionId);
  const hidden = me?.status === 'hidden';
  const now = performance.now();
  const lock = () => engine.current?.requestLock();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} onClick={() => !ui.paused && ui.screen === 'game' && lock()} />
      {ui.screen === 'game' && (
        <div className="hud">
          {hidden && <><div className="locker-frame" /><div className="locker-slits" /></>}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(ellipse at center, transparent ${55 - ui.fear * 25}%, rgba(60,0,0,${0.15 + ui.fear * 0.55}))` }} />
          {ui.hitFlash > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(183,73,79,${ui.hitFlash * 0.35})` }} />}
          {me?.status === 'downed' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(80,0,0,.35)', backdropFilter: 'grayscale(.8)' }} />}
          <div className="cross" />
          {ui.prompt && !ui.paused && <div className="prompt"><span className="mono" style={{ color: 'var(--warn)' }}>[E]</span> {ui.prompt.text}</div>}
          {ui.invalid && now - ui.invalid.at < 2200 && <div className="invalid">✕ {ui.invalid.text}</div>}
          {s && <LeftHud s={s} selected={ui.selectedSlot} />}
          {s && <Objective s={s} />}
          {s && <Team s={s} myId={ui.sessionId} />}
          <div className="notices">{ui.notices.filter((n) => now - n.at < 6000).map((n) => <div key={n.id} className={n.kind}>{n.text}</div>)}</div>
          <div className="subs">{ui.subtitles.filter((n) => now - n.at < 4500).map((n) => <div key={n.id}>{n.text}</div>)}</div>
          {s && me?.status === 'downed' && <div className="prompt" style={{ top: '40%', borderColor: 'var(--danger)' }}>DOWNED – {Math.ceil(me.downedLeft)}s · teammates can revive you with a Medkit · <span className="mono">H</span> call for help</div>}
          {s && me?.status === 'dead' && <div className="prompt" style={{ top: '40%' }}>You are dead. Spectating your team…</div>}
          {s && me?.status === 'escaped' && <div className="prompt" style={{ top: '40%', borderColor: '#67a897' }}>You escaped. Waiting for the others…</div>}
          {s?.self.hold && <div style={{ position: 'absolute', left: '50%', top: '54%', width: 220, marginLeft: -110 }} className="bar"><div style={{ width: `${s.self.hold.progress * 100}%`, background: 'var(--warn)' }} /></div>}
          {ui.conn !== 'connected' && <div className="prompt" style={{ top: 70, borderColor: 'var(--warn)' }}>{ui.conn === 'reconnecting' ? 'Connection lost – reconnecting (up to 60 s)…' : 'Disconnected from the server.'}{ui.conn === 'lost' && <button className="btn" style={{ marginLeft: 10, pointerEvents: 'auto' }} onClick={() => { net.leave(); ui.go('menu'); }}>Menu</button>}</div>}
          {ui.showMap && s && <MapOverlay s={s} />}
          {ui.showInventory && s && <Backpack s={s} />}
          {ui.doc && (
            <div className="modal-back">
              <div className="panel" style={{ padding: 26, maxWidth: 520, background: '#e9e4d8', color: '#1b1b1b' }}>
                <div className="mono" style={{ fontSize: 12, color: '#555' }}>SYNAPSE // RECOVERED DOCUMENT</div>
                <h3 style={{ margin: '6px 0 12px' }}>{ui.doc.title}</h3>
                <p className="mono" style={{ lineHeight: 1.6 }}>{ui.doc.body}</p>
                <button className="btn" onClick={() => { ui.set({ doc: null }); lock(); }}>Close</button>
              </div>
            </div>
          )}
          {ui.keypad && <Keypad onDone={() => { ui.set({ keypad: false }); lock(); }} knownCode={s?.self.knownCode ?? null} />}
          {ui.paused && !ui.keypad && !ui.doc && <Pause onResume={lock} />}
        </div>
      )}
    </div>
  );
}

function LeftHud({ s, selected }: { s: Snapshot; selected: number }) {
  const me = s.players.find((p) => p.id === useUI.getState().sessionId);
  const hp = me?.hp ?? 0;
  return (
    <div className="tl col" style={{ gap: 8 }}>
      <div><div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span>HEALTH</span><span className="mono">{Math.round(hp)}</span></div><div className="bar"><div style={{ width: `${(hp / HEALTH_MAX) * 100}%`, background: hp < 35 ? 'var(--danger)' : '#c9d2d6' }} /></div></div>
      <div><div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span>STAMINA</span></div><div className="bar"><div style={{ width: `${(s.self.stamina / STAMINA.max) * 100}%`, background: 'var(--accent)' }} /></div></div>
      <div><div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span>FLASHLIGHT</span><span className="mono">{Math.round(s.self.battery)}%</span></div><div className="bar"><div style={{ width: `${s.self.battery}%`, background: 'var(--warn)' }} /></div></div>
      <div className="row" style={{ gap: 6 }}>
        {s.self.inventory.map((it, i) => (
          <div key={i} className={`slot ${i === selected ? 'sel' : ''}`}><span className="k">{i + 1}</span>{it ? ITEM_LABEL[it] : ''}</div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11 }}>Q use · G drop · Tab backpack · M map</div>
    </div>
  );
}

function Objective({ s }: { s: Snapshot }) {
  const o = s.objective;
  return (
    <div className="tr panel" style={{ padding: 14 }}>
      <div className="mono muted" style={{ fontSize: 11, letterSpacing: '.15em' }}>CURRENT OBJECTIVE</div>
      <div style={{ fontWeight: 600, marginTop: 4 }}>{o.title}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
        {o.steps.map((st, i) => <li key={i} style={{ color: st.done ? '#67a897' : 'var(--text)', marginBottom: 3 }}>{st.done ? '✓' : '○'} {st.text}</li>)}
      </ul>
      {o.progress !== null && <div className="bar" style={{ marginTop: 8 }}><div style={{ width: `${Math.min(1, o.progress) * 100}%`, background: 'var(--warn)' }} /></div>}
      {o.finalTimeLeft !== null && <div className="mono" style={{ marginTop: 8, color: 'var(--danger)', fontSize: 20 }}>LIFT DEPARTS IN {Math.ceil(o.finalTimeLeft)}s</div>}
      {s.self.knownCode && o.stage === 'data' && <div className="mono" style={{ marginTop: 6, fontSize: 12, color: 'var(--warn)' }}>Terminal code: {s.self.knownCode}</div>}
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Documents {o.documentsFound}/{o.documentsTotal} · Power {o.powerOn ? 'ON' : 'OFF'}</div>
    </div>
  );
}

function Team({ s, myId }: { s: Snapshot; myId: string | null }) {
  const others = s.players.filter((p) => p.id !== myId);
  if (!others.length) return null;
  return (
    <div className="team">
      {others.map((p) => (
        <div key={p.id} className="panel" style={{ padding: '6px 10px', fontSize: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: CHARACTERS.find((c) => c.id === p.character)?.color, marginRight: 6 }} />{p.name}</span>
            <span style={{ color: p.status === 'downed' ? 'var(--danger)' : p.status === 'escaped' ? '#67a897' : 'var(--muted)' }}>
              {!p.connected ? 'reconnecting' : p.status === 'downed' ? `DOWN ${Math.ceil(p.downedLeft)}s` : p.status === 'hidden' ? 'alive' : p.status}
            </span>
          </div>
          {p.status !== 'dead' && p.status !== 'escaped' && <div className="bar" style={{ height: 4, marginTop: 4 }}><div style={{ width: `${p.hp}%`, background: '#c9d2d6' }} /></div>}
        </div>
      ))}
    </div>
  );
}

function MapOverlay({ s }: { s: Snapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const me = s.players.find((p) => p.id === useUI.getState().sessionId);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    const k = 14;
    g.fillStyle = '#0b1117'; g.fillRect(0, 0, c.width, c.height);
    for (const z of ZONES) {
      if (!s.self.zonesVisited.includes(z.id)) continue; // only what you have explored
      g.fillStyle = '#1f2c38';
      g.fillRect(z.x0 * k, z.y0 * k, (z.x1 - z.x0 + 1) * k, (z.y1 - z.y0 + 1) * k);
      g.fillStyle = '#9ba9b3'; g.font = '11px Inter';
      if (z.x1 - z.x0 > 3) g.fillText(z.name, z.x0 * k + 4, z.y0 * k + 14);
    }
    const visited = ZONES.filter((z) => s.self.zonesVisited.includes(z.id));
    const touches = (tx: number, ty: number) => visited.some((z) => tx >= z.x0 - 1 && tx <= z.x1 + 1 && ty >= z.y0 - 1 && ty <= z.y1 + 1);
    for (const d of DOORS) {
      if (!touches(d.tx, d.ty)) continue; // never reveal unexplored layout
      g.fillStyle = s.doors[d.id] ? '#6b9a9d' : d.kind === 'exit' ? '#b7494f' : '#c59a58';
      g.fillRect(d.tx * k + 3, d.ty * k + 3, k - 6, k - 6);
    }
    if (me) {
      const x = (me.x / 1.5) * k, y = (me.z / 1.5) * k;
      g.fillStyle = '#e5e9ea';
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#e5e9ea'; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(me.yaw) * 14, y - Math.cos(me.yaw) * 14); g.stroke();
    }
  }, [s, me]);
  return (
    <div className="modal-back" style={{ pointerEvents: 'none', background: 'rgba(0,0,0,.45)' }}>
      <div className="panel" style={{ padding: 14 }}>
        <div className="mono muted" style={{ fontSize: 11, marginBottom: 6 }}>FACILITY B4 – EXPLORED AREAS (M to close)</div>
        <canvas ref={ref} width={MAP_W * 14} height={MAP_H * 14} />
      </div>
    </div>
  );
}

function Backpack({ s }: { s: Snapshot }) {
  return (
    <div className="modal-back" style={{ pointerEvents: 'none', background: 'rgba(0,0,0,.4)' }}>
      <div className="panel" style={{ padding: 20, minWidth: 360 }}>
        <div className="mono muted" style={{ fontSize: 11 }}>BACKPACK (Tab to close)</div>
        <table style={{ marginTop: 10, width: '100%', fontSize: 14 }}>
          <tbody>
            {s.self.inventory.map((it, i) => <tr key={i}><td className="mono">{i + 1}</td><td>{it ? ITEM_LABEL[it] : <span className="muted">empty</span>}</td></tr>)}
            <tr><td>🔦</td><td>Flashlight · {Math.round(s.self.battery)}% battery</td></tr>
            <tr><td>📄</td><td>Documents found by team: {s.objective.documentsFound}/{s.objective.documentsTotal}</td></tr>
            {s.self.knownCode && <tr><td>🔑</td><td>Terminal code: <span className="mono">{s.self.knownCode}</span></td></tr>}
            <tr><td>♥</td><td>Times downed: {s.self.downs}/2{s.self.selfRevives > 0 ? ` · self-revives left: ${s.self.selfRevives}` : ''}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Keypad({ onDone, knownCode }: { onDone: () => void; knownCode: string | null }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async () => {
    const r = await net.interact('terminal', 'enter_code', { code });
    if (r.ok) onDone();
    else { setMsg(r.reason ?? 'Denied'); setCode(''); }
  };
  return (
    <div className="modal-back">
      <div className="panel keypad" style={{ padding: 22, background: '#0a1414', borderColor: 'var(--accent)' }}>
        <div className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>SYNAPSE RESEARCH TERMINAL · AUTH REQUIRED</div>
        <div className="mono" style={{ fontSize: 34, letterSpacing: '.4em', margin: '12px 0', minHeight: 44 }}>{code.padEnd(4, '_')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: 6 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map((k) => (
            <button key={k} className={`btn ${k === 'OK' ? 'primary' : ''}`} onClick={() => (k === 'C' ? setCode('') : k === 'OK' ? submit() : code.length < 4 && setCode(code + k))}>{k}</button>
          ))}
        </div>
        {msg && <div style={{ color: '#ffb3b8', marginTop: 8 }} className="mono">{msg}</div>}
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{knownCode ? `Your note: ${knownCode}` : 'Hint: someone left the code on a whiteboard in this lab.'}</div>
        <button className="btn" style={{ marginTop: 10 }} onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

function Pause({ onResume }: { onResume: () => void }) {
  const [settings, setSettings] = useState(false);
  const ui = useUI();
  if (settings) return <div className="modal-back"><SettingsPanel onClose={() => setSettings(false)} /></div>;
  return (
    <div className="modal-back">
      <div className="panel col" style={{ padding: 26, width: 340 }}>
        <h2 className="logo" style={{ margin: 0 }}>PAUSED</h2>
        <div className="muted" style={{ fontSize: 13 }}>The match keeps running on the server – you are still in danger.</div>
        <button className="btn primary" onClick={onResume}>Resume (click to lock mouse)</button>
        <button className="btn" onClick={() => setSettings(true)}>Settings</button>
        <button className="btn danger" onClick={() => { net.leave(); ui.go('menu'); ui.set({ paused: false }); }}>Leave match</button>
      </div>
    </div>
  );
}
