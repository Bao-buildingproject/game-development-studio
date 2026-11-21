import { create } from 'zustand';

export type Action = 'forward' | 'back' | 'left' | 'right' | 'run' | 'crouch' | 'interact' | 'flashlight' | 'drop' | 'inventory' | 'map' | 'talk' | 'use' | 'distress';
export const ACTION_LABEL: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', run: 'Run', crouch: 'Crouch',
  interact: 'Interact (hold for revive / exit)', flashlight: 'Flashlight', drop: 'Drop item', inventory: 'Backpack', map: 'Found map',
  talk: 'Push-to-talk (post-MVP)', use: 'Use selected item', distress: 'Distress call (when downed)',
};
export const DEFAULT_KEYS: Record<Action, string[]> = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], run: ['ShiftLeft', 'ShiftRight'], crouch: ['ControlLeft', 'KeyC'],
  interact: ['KeyE'], flashlight: ['KeyF'], drop: ['KeyG'], inventory: ['Tab'], map: ['KeyM'], talk: ['KeyV'], use: ['KeyQ'], distress: ['KeyH'],
};

export interface Settings {
  name: string;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  brightness: number;
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  subtitles: boolean;
  reduceShake: boolean;
  reduceScares: boolean;
  keys: Record<Action, string[]>;
  seenPointerLockNotice: boolean;
}

const DEFAULTS: Settings = {
  name: '', sensitivity: 1, invertY: false, fov: 75, brightness: 1, master: 0.8, sfx: 1, ambience: 0.7, music: 0.6,
  subtitles: true, reduceShake: false, reduceScares: false, keys: DEFAULT_KEYS, seenPointerLockNotice: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem('itlearns.settings');
    if (raw) { const s = JSON.parse(raw); return { ...DEFAULTS, ...s, keys: { ...DEFAULT_KEYS, ...(s.keys ?? {}) } }; }
  } catch { /* storage unavailable */ }
  return DEFAULTS;
}

export const useSettings = create<Settings & { set: (p: Partial<Settings>) => void; reset: () => void }>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p);
    try { const { set: _s, reset: _r, ...rest } = get(); void _s; void _r; localStorage.setItem('itlearns.settings', JSON.stringify(rest)); } catch { /* ignore */ }
  },
  reset: () => { set({ ...DEFAULTS }); try { localStorage.removeItem('itlearns.settings'); } catch { /* ignore */ } },
}));

export const keyName = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R');
