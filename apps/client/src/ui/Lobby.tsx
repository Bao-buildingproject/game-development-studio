import { useState } from 'react';
import { CHARACTERS, MAX_PLAYERS } from '@itl/shared';
import { useUI } from '../state';
import { net } from '../game/network/net';

export default function Lobby() {
  const { lobby, sessionId, conn, go } = useUI();
  const [copied, setCopied] = useState(false);
  if (!lobby) return <div className="screen"><div className="panel" style={{ padding: 24, zIndex: 2 }}>Connecting… <button className="btn" onClick={() => { net.leave(); go('menu'); }}>Cancel</button></div></div>;
  const me = lobby.players.find((p) => p.id === sessionId);
  const isHost = !!me?.host;
  const othersReady = lobby.players.filter((p) => !p.host).every((p) => p.ready);
  const copy = async () => {
    try { await navigator.clipboard.writeText(lobby.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="screen">
      <div className="panel" style={{ padding: 28, width: 'min(860px, 94vw)', zIndex: 2 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted mono" style={{ fontSize: 12, letterSpacing: '.2em' }}>ROOM CODE</div>
            <div className="row">
              <span className="mono" style={{ fontSize: 40, letterSpacing: '.25em' }}>{lobby.code}</span>
              <button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy Room Code'}</button>
            </div>
          </div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
            <span className="chip" style={{ borderColor: conn === 'connected' ? '#67a897' : 'var(--warn)' }}>● {conn}</span>
            <span className="muted" style={{ fontSize: 13 }}>{lobby.map}</span>
          </div>
        </div>
        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {Array.from({ length: MAX_PLAYERS }).map((_, i) => {
            const p = lobby.players[i];
            const ch = p && CHARACTERS.find((c) => c.id === p.character);
            return (
              <div key={i} className="panel" style={{ padding: 14, minHeight: 120, borderColor: p?.id === sessionId ? 'var(--accent)' : undefined, opacity: p ? 1 : 0.45 }}>
                {p ? (
                  <>
                    <div style={{ width: 28, height: 28, borderRadius: 14, background: ch?.color }} />
                    <div style={{ fontWeight: 600, marginTop: 8 }}>{p.name}{p.host && <span className="chip" style={{ marginLeft: 6 }}>HOST</span>}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{ch?.name}</div>
                    <div style={{ marginTop: 6, color: p.ready || p.host ? '#67a897' : 'var(--muted)', fontSize: 13 }}>{p.host ? 'Host' : p.ready ? 'READY' : 'Not ready'}{!p.connected && ' · reconnecting'}</div>
                  </>
                ) : <span className="muted">Empty slot</span>}
              </div>
            );
          })}
        </div>
        {lobby.players.length >= MAX_PLAYERS && <div className="muted" style={{ marginTop: 8 }}>Room is full (4/4).</div>}
        <div className="row" style={{ marginTop: 18, flexWrap: 'wrap' }}>
          <span className="muted">Character:</span>
          {CHARACTERS.map((c) => {
            const taken = lobby.players.some((p) => p.character === c.id && p.id !== sessionId);
            return <button key={c.id} className="btn" disabled={taken} style={{ borderColor: me?.character === c.id ? c.color : undefined }} onClick={() => net.ready(!!me?.ready, c.id)}>{c.name}</button>;
          })}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted">Difficulty:</span>
          {(['standard', 'hardcore'] as const).map((d) => (
            <button key={d} className="btn" disabled={!isHost} style={{ borderColor: lobby.difficulty === d ? 'var(--warn)' : undefined }} onClick={() => net.settings(d)}>{d === 'standard' ? 'Standard Hunt' : 'Hardcore Hunt'}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 22, justifyContent: 'space-between' }}>
          <button className="btn danger" onClick={() => { net.leave(); go('menu'); }}>Leave</button>
          <div className="row">
            {!isHost && <button className={`btn ${me?.ready ? '' : 'primary'}`} onClick={() => net.ready(!me?.ready)}>{me?.ready ? 'Cancel Ready' : 'Ready'}</button>}
            {isHost && <button className="btn primary" disabled={!othersReady} onClick={() => net.start()} title={othersReady ? '' : 'Waiting for players to be ready'}>START MATCH ({lobby.players.length}/{MAX_PLAYERS})</button>}
          </div>
        </div>
        {isHost && !othersReady && <div className="muted" style={{ marginTop: 8, fontSize: 13, textAlign: 'right' }}>Waiting for everyone to press Ready…</div>}
      </div>
    </div>
  );
}
