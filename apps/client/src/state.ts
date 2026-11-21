import { create } from 'zustand';
import type { GameEvent, LobbyState, MatchResult, Snapshot } from '@itl/shared';

export type Screen = 'menu' | 'join' | 'howto' | 'settings' | 'credits' | 'lobby' | 'game' | 'results';
export type ConnState = 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface Subtitle { id: string; text: string; at: number }
export interface Notice { id: string; text: string; at: number; kind: 'info' | 'bad' | 'good' }

interface UIState {
  screen: Screen;
  prevScreen: Screen;
  conn: ConnState;
  sessionId: string | null;
  lobby: LobbyState | null;
  hud: Snapshot | null; // throttled copy for React
  result: MatchResult | null;
  subtitles: Subtitle[];
  notices: Notice[];
  prompt: { text: string; hold: boolean } | null;
  invalid: { text: string; at: number } | null;
  doc: { title: string; body: string } | null;
  keypad: boolean;
  paused: boolean;
  showMap: boolean;
  showInventory: boolean;
  selectedSlot: number;
  error: string | null;
  fear: number;
  hitFlash: number;
  go: (s: Screen) => void;
  set: (p: Partial<UIState>) => void;
  addSubtitle: (e: GameEvent) => void;
  addNotice: (text: string, kind?: Notice['kind']) => void;
}

let n = 0;
export const useUI = create<UIState>((set, get) => ({
  screen: 'menu', prevScreen: 'menu', conn: 'offline', sessionId: null, lobby: null, hud: null, result: null, subtitles: [], notices: [],
  prompt: null, invalid: null, doc: null, keypad: false, paused: false, showMap: false, showInventory: false, selectedSlot: 0, error: null,
  fear: 0, hitFlash: 0,
  go: (screen) => set({ prevScreen: get().screen, screen }),
  set: (p) => set(p),
  addSubtitle: (e) => {
    if (!e.text) return;
    const now = performance.now();
    set({ subtitles: [...get().subtitles.filter((s) => now - s.at < 4500), { id: `${e.id}-${++n}`, text: e.text, at: now }].slice(-4) });
  },
  addNotice: (text, kind = 'info') => {
    const now = performance.now();
    set({ notices: [...get().notices.filter((s) => now - s.at < 6000), { id: `n${++n}`, text, at: now, kind }].slice(-5) });
  },
}));
