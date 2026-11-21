import type { Difficulty } from './constants';
import type { MoveInput } from './movement';
import type { ZoneId } from './map';

/** Message names (GDD §45). */
export const C2S = {
  input: 'player_input',
  interact: 'interact_request',
  useItem: 'use_item_request',
  dropItem: 'drop_item_request',
  ready: 'ready_request',
  start: 'start_match_request',
  lobbySettings: 'lobby_settings_request',
  returnToLobby: 'return_to_lobby_request',
} as const;

export const S2C = {
  lobby: 'lobby_state',
  snapshot: 'world_snapshot',
  event: 'game_event',
  interactionResult: 'interaction_result',
  objective: 'objective_updated',
  damage: 'damage_event',
  result: 'match_result',
  welcome: 'welcome',
} as const;

export type ItemKind = 'battery' | 'fuse' | 'keycard' | 'medkit' | 'noise_maker' | 'document';
export const ITEM_LABEL: Record<ItemKind, string> = {
  battery: 'Battery', fuse: 'Fuse', keycard: 'Keycard', medkit: 'Medkit', noise_maker: 'Noise Maker', document: 'Research Document',
};

export type PlayerStatus = 'alive' | 'downed' | 'dead' | 'escaped' | 'hidden';
export const CHARACTERS = [
  { id: 'vega', name: 'Vega', color: '#6B9A9D' },
  { id: 'ortiz', name: 'Ortiz', color: '#C59A58' },
  { id: 'kim', name: 'Kim', color: '#9BA9B3' },
  { id: 'adeyemi', name: 'Adeyemi', color: '#B7494F' },
] as const;
export type CharacterId = (typeof CHARACTERS)[number]['id'];

export type InputMsg = MoveInput & { flashlight: boolean };
export interface InteractMsg { requestId: string; entityId: string; action: string; payload?: { code?: string } }
export interface SlotMsg { requestId: string; slot: number }
export interface ReadyMsg { ready: boolean; character?: CharacterId; name?: string }
export interface LobbySettingsMsg { difficulty?: Difficulty; aiHearsVoice?: boolean }

export interface LobbyPlayer { id: string; name: string; character: CharacterId; ready: boolean; host: boolean; connected: boolean }
export interface LobbyState {
  code: string;
  phase: 'lobby' | 'playing' | 'ended';
  players: LobbyPlayer[];
  difficulty: Difficulty;
  map: string;
  maxPlayers: number;
}

export interface PlayerView {
  id: string;
  name: string;
  character: CharacterId;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mode: string;
  status: PlayerStatus;
  hp: number;
  flashlight: boolean;
  connected: boolean;
  downedLeft: number;
  holdProgress: number; // 0..1 while channeling
}

export interface SelfView {
  lastSeq: number;
  stamina: number;
  staminaDelay: number;
  battery: number;
  inventory: (ItemKind | null)[];
  downs: number;
  selfRevives: number;
  lockerId: string | null;
  hold: { kind: string; progress: number } | null;
  knownCode: string | null;
  zonesVisited: ZoneId[];
}

export type MonsterPresentation = 'calm' | 'alert' | 'hunting' | 'attacking' | 'checking';
export interface MonsterView { x: number; z: number; yaw: number; look: MonsterPresentation }

export interface ItemView { id: string; kind: ItemKind; x: number; z: number }

export interface ObjectiveView {
  stage: 'power' | 'data' | 'protocol' | 'escape' | 'done';
  title: string;
  steps: { text: string; done: boolean }[];
  progress: number | null; // channel/meter 0..1
  finalTimeLeft: number | null;
  powerOn: boolean;
  documentsFound: number;
  documentsTotal: number;
}

export interface Snapshot {
  t: number; // server tick
  time: number; // match seconds
  self: SelfView;
  players: PlayerView[];
  monster: MonsterView | null; // culled when far & out of sight (no wallhack data)
  doors: Record<string, boolean>;
  items: ItemView[];
  lockersOccupiedBySelf: string | null;
  fixtures: Record<string, string>; // fixture state labels
  objective: ObjectiveView;
}

export type GameEventKind =
  | 'sound' | 'subtitle' | 'adapted' | 'door' | 'pickup' | 'downed' | 'revived' | 'died' | 'escaped' | 'power_on' | 'final_hunt'
  | 'player_left' | 'player_reconnected' | 'document' | 'locker_checked' | 'attack_windup' | 'notice';
export interface GameEvent {
  id: string; // unique event id (GDD §45)
  kind: GameEventKind;
  text?: string;
  x?: number;
  z?: number;
  sound?: string;
  loud?: number;
  title?: string;
  body?: string;
}

export interface InteractionResult { requestId: string; ok: boolean; reason?: string }
export interface DamageEvent { id: string; target: string; amount: number; hp: number }

export interface LearnedSummary { behavior: string; score: number; tier: string; note: string }
export interface MatchResult {
  outcome: 'escaped_all' | 'escaped_some' | 'wiped';
  ending: string;
  endingText: string;
  durationSec: number;
  players: { id: string; name: string; fate: PlayerStatus | 'left'; downs: number }[];
  missionsCompleted: number;
  documents: number;
  learned: LearnedSummary[];
  seed: number;
}
