import { useState } from 'react';
import { useUI } from '../state';
import { useSettings, keyName } from '../settings';
import { net } from '../game/network/net';
import { audio } from '../game/audio/audio';

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="screen">
      <div className="panel" style={{ padding: 28, width: 'min(760px, 92vw)', maxHeight: '88vh', overflow: 'auto', position: 'relative', zIndex: 2 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="logo" style={{ margin: 0 }}>{title}</h2>
          <button className="btn" onClick={() => useUI.getState().go('menu')}>Back</button>
        </div>
        <div style={{ marginTop: 16 }}>{children}</div>
      </div>
    </div>
  );
}

export function Join() {
  const [code, setCode] = useState('');
  const { error, conn, go } = useUI();
  const name = useSettings((s) => s.name) || 'Responder';
  const join = async () => {
    audio.init();
    if (await net.join(code, name)) go('lobby');
  };
  return (
    <Page title="JOIN ROOM">
      <div className="col" style={{ maxWidth: 360 }}>
        <span className="muted">Enter the 6-character room code from your host.</span>
        <input className="mono" style={{ fontSize: 26, letterSpacing: '.3em', textTransform: 'uppercase' }} maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && join()} autoFocus />
        <button className="btn primary" disabled={code.length !== 6 || conn === 'connecting'} onClick={join}>Join</button>
        {error && <div style={{ color: '#ffb3b8' }}>{error}</div>}
      </div>
    </Page>
  );
}

export function HowTo() {
  const keys = useSettings((s) => s.keys);
  const k = (a: keyof typeof keys) => keys[a].map(keyName).join(' / ');
  return (
    <Page title="HOW TO PLAY">
      <p>You are an emergency response team sealed inside SYNAPSE facility B4. Restore power, recover the research data, unlock the emergency protocol and escape.</p>
      <p><b>Subject 47 learns.</b> It only knows what it has seen or heard – but it remembers. If you always hide in lockers, it starts checking lockers. If you keep using the same decoy, it stops falling for it. Change your habits.</p>
      <table style={{ width: '100%', fontSize: 14, margin: '12px 0' }}>
        <tbody>
          <tr><td>Move</td><td className="mono">{k('forward')} {k('left')} {k('back')} {k('right')}</td><td>Run / Crouch</td><td className="mono">{k('run')} / {k('crouch')}</td></tr>
          <tr><td>Interact (hold for revive / exit)</td><td className="mono">{k('interact')}</td><td>Flashlight</td><td className="mono">{k('flashlight')}</td></tr>
          <tr><td>Select slot / use item</td><td className="mono">1–4 / {k('use')}</td><td>Drop item</td><td className="mono">{k('drop')}</td></tr>
          <tr><td>Backpack / Map</td><td className="mono">{k('inventory')} / {k('map')}</td><td>Call for help (downed)</td><td className="mono">{k('distress')}</td></tr>
          <tr><td>Pause / settings</td><td className="mono">Esc</td><td>Push-to-talk</td><td className="mono">{k('talk')} (post-MVP)</td></tr>
        </tbody>
      </table>
      <ul className="muted" style={{ lineHeight: 1.7 }}>
        <li>Running, doors, the generator and the terminal make noise. Crouching is silent but slow.</li>
        <li>A flashlight helps you see – and helps it see you.</li>
        <li>At 0 HP you are <b>downed</b> for 45 s. A teammate with a Medkit can revive you (hold E, 6 s). Solo players get two self-revives.</li>
        <li>Noise Makers (Q) lure the creature away… until it learns.</li>
        <li>There is always a loop route. If you are chased, break line of sight and change direction.</li>
      </ul>
    </Page>
  );
}

export function Credits() {
  return (
    <Page title="CREDITS">
      <p>IT LEARNS: THE HUNT – Project SYNAPSE prototype.</p>
      <p className="muted">Design: Master GDD v1.0. Engineering: server-authoritative Colyseus simulation, Three.js client, procedural WebAudio. All characters, places and events are fictional.</p>
      <p className="muted">No external art or audio assets – everything is generated at runtime.</p>
    </Page>
  );
}
