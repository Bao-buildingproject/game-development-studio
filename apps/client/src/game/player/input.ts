import { Action, useSettings } from '../../settings';

/** Keyboard + mouse capture with rebindable actions (GDD §8). */
export class InputState {
  private down = new Set<string>();
  private pressed = new Set<Action>();
  yaw = 0;
  pitch = 0;
  locked = false;
  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Tab') e.preventDefault();
    if (!this.down.has(e.code)) {
      const a = this.actionOf(e.code);
      if (a) this.pressed.add(a);
      if (/^Digit[1-4]$/.test(e.code)) this.slotPressed = Number(e.code.slice(5)) - 1;
    }
    this.down.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.down.delete(e.code); };
  private onMouse = (e: MouseEvent) => {
    if (!this.locked) return;
    const s = useSettings.getState();
    const k = 0.0022 * s.sensitivity;
    this.yaw -= e.movementX * k;
    this.pitch -= e.movementY * k * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  };
  private onLock = () => { this.locked = document.pointerLockElement != null; };
  private onBlur = () => { this.down.clear(); };
  slotPressed: number | null = null;

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouse);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLock);
  }
  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouse);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
  }
  private actionOf(code: string): Action | null {
    const keys = useSettings.getState().keys;
    for (const [a, codes] of Object.entries(keys)) if (codes.includes(code)) return a as Action;
    return null;
  }
  held(a: Action) { return useSettings.getState().keys[a].some((c) => this.down.has(c)); }
  consume(a: Action) { const had = this.pressed.has(a); this.pressed.delete(a); return had; }
  clearPressed() { this.pressed.clear(); this.slotPressed = null; }
}
