import { useUI } from '../state';
import { net } from '../game/network/net';

export default function Results() {
  const { result, lobby, sessionId, go } = useUI();
  if (!result) return null;
  const isHost = lobby?.players.find((p) => p.id === sessionId)?.host;
  const color = result.outcome === 'wiped' ? 'var(--danger)' : result.outcome === 'escaped_all' ? '#67a897' : 'var(--warn)';
  const mm = `${Math.floor(result.durationSec / 60)}:${String(result.durationSec % 60).padStart(2, '0')}`;
  return (
    <div className="screen" style={{ background: 'rgba(5,8,11,.88)', zIndex: 5 }}>
      <div className="panel" style={{ padding: 30, width: 'min(820px, 94vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="mono muted" style={{ fontSize: 12, letterSpacing: '.2em' }}>MATCH RESULT · SERVER CONFIRMED</div>
        <h1 className="logo" style={{ margin: '6px 0', color }}>{result.ending.toUpperCase()}</h1>
        <p>{result.endingText}</p>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', margin: '10px 0 18px' }}>
          <span className="chip">Time {mm}</span><span className="chip">Missions {result.missionsCompleted}/3</span><span className="chip">Documents {result.documents}/5</span><span className="chip mono">seed {result.seed}</span>
        </div>
        <table style={{ width: '100%' }}>
          <thead><tr className="muted"><th>Responder</th><th>Fate</th><th>Times downed</th></tr></thead>
          <tbody>{result.players.map((p) => <tr key={p.id}><td>{p.name}</td><td style={{ color: p.fate === 'escaped' ? '#67a897' : 'var(--danger)' }}>{p.fate}</td><td>{p.downs}</td></tr>)}</tbody>
        </table>
        <h3 style={{ marginTop: 22 }}>What Subject 47 learned about you</h3>
        {result.learned.length === 0 ? <p className="muted">It barely saw you. Lucky – or careful.</p> : (
          <table style={{ width: '100%' }}>
            <tbody>
              {result.learned.sort((a, b) => b.score - a.score).map((l) => (
                <tr key={l.behavior}><td>{l.behavior.replace('_', ' ')}</td><td style={{ width: 200 }}><div className="bar"><div style={{ width: `${l.score}%`, background: 'var(--danger)' }} /></div></td><td>{l.tier}</td><td className="muted">{l.note}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: 13 }}>Its memory is per match – the next hunt starts fresh. Your habits do not.</p>
        <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="btn danger" onClick={() => { net.leave(); go('menu'); }}>Leave</button>
          {isHost ? <button className="btn primary" onClick={() => net.returnToLobby()}>Return to lobby / play again</button> : <span className="muted">Waiting for the host to return to the lobby…</span>}
        </div>
      </div>
    </div>
  );
}
