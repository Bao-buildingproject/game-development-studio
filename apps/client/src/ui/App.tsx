import { useUI } from '../state';
import Menu from './Menu';
import Lobby from './Lobby';
import Game from './Game';
import Results from './Results';
import SettingsPanel from './SettingsPanel';
import { HowTo, Credits, Join } from './Pages';

export default function App() {
  const screen = useUI((s) => s.screen);
  return (
    <>
      {(screen !== 'game') && <div className="menu-bg" />}
      {screen === 'menu' && <Menu />}
      {screen === 'join' && <Join />}
      {screen === 'howto' && <HowTo />}
      {screen === 'credits' && <Credits />}
      {screen === 'settings' && <div className="screen"><SettingsPanel onClose={() => useUI.getState().go(useUI.getState().prevScreen === 'settings' ? 'menu' : useUI.getState().prevScreen)} /></div>}
      {screen === 'lobby' && <Lobby />}
      {(screen === 'game' || screen === 'results') && <Game />}
      {screen === 'results' && <Results />}
      {screen !== 'game' && <div className="scan" />}
      {screen !== 'game' && <div className="vignette" />}
    </>
  );
}
