import { useSettings } from '../../settings';

/**
 * Procedural WebAudio – no external assets. Layers: ambient / environment / creature / psychological / music (GDD §35).
 * Danger sounds are spatialised (HRTF) so they give reliable direction.
 */
class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ambient: { hum: OscillatorNode; hum2: OscillatorNode; humGain: GainNode; windGain: GainNode } | null = null;
  private breath: { src: AudioBufferSourceNode; gain: GainNode; panner: PannerNode } | null = null;
  private chase: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private heart = 0;

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const k of ['sfx', 'amb', 'music'] as const) { const g = ctx.createGain(); g.connect(this.master); this[k] = g; }
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbient();
    this.startBreath();
    this.startChase();
    useSettings.subscribe(() => this.applyVolumes());
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = useSettings.getState();
    this.master.gain.value = s.master;
    this.sfx.gain.value = s.sfx;
    this.amb.gain.value = s.ambience;
    this.music.gain.value = s.music;
  }

  setListener(x: number, y: number, z: number, yaw: number) {
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    const t = this.ctx!.currentTime;
    l.positionX.setTargetAtTime(x, t, 0.02); l.positionY.setTargetAtTime(y, t, 0.02); l.positionZ.setTargetAtTime(z, t, 0.02);
    l.forwardX.setTargetAtTime(-Math.sin(yaw), t, 0.02); l.forwardY.setTargetAtTime(0, t, 0.02); l.forwardZ.setTargetAtTime(-Math.cos(yaw), t, 0.02);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }

  private panner(x: number, z: number, y = 1.2, ref = 2, max = 40) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = max;
    p.rolloffFactor = 1.3;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(this.sfx);
    return p;
  }

  private noise(dest: AudioNode, dur: number, freq: number, q = 1, gain = 0.5, type: BiquadFilterType = 'lowpass', t0 = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + t0;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, gain = 0.3, t0 = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private startAmbient() {
    const ctx = this.ctx!;
    const humGain = ctx.createGain(); humGain.gain.value = 0.02; humGain.connect(this.amb);
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 50;
    const hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 100.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    hum.connect(lp); hum2.connect(lp); lp.connect(humGain);
    hum.start(); hum2.start();
    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuf; wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 250;
    lfo.connect(lfoG).connect(bp.frequency); lfo.start();
    const windGain = ctx.createGain(); windGain.gain.value = 0.05;
    wind.connect(bp).connect(windGain).connect(this.amb);
    wind.start();
    this.ambient = { hum, hum2, humGain, windGain };
  }

  setPower(on: boolean) {
    if (!this.ambient || !this.ctx) return;
    this.ambient.humGain.gain.setTargetAtTime(on ? 0.06 : 0.02, this.ctx.currentTime, 1);
  }

  private startBreath() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 280; f.Q.value = 2;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.45;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    const breathAmp = ctx.createGain(); breathAmp.gain.value = 0.5;
    lfo.connect(lfoG).connect(breathAmp.gain); lfo.start();
    const panner = this.panner(0, 0, 2.2, 1.5, 30);
    src.connect(f).connect(breathAmp).connect(gain).connect(panner);
    src.start();
    this.breath = { src, gain, panner };
  }

  private startChase() {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pulse = ctx.createGain(); pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 2.2;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(pulse.gain);
    osc.connect(lp).connect(pulse).connect(gain).connect(this.music);
    osc.start(); lfo.start();
    this.chase = { osc, lfo, gain };
  }

  /** Creature presence: positional breathing; chase music only when it is actually hunting nearby. */
  updateCreature(m: { x: number; z: number; look: string } | null, dist: number) {
    if (!this.ctx || !this.breath || !this.chase) return;
    const t = this.ctx.currentTime;
    if (!m) { this.breath.gain.gain.setTargetAtTime(0, t, 0.5); this.chase.gain.gain.setTargetAtTime(0, t, 1.5); return; }
    this.breath.panner.positionX.setTargetAtTime(m.x, t, 0.05);
    this.breath.panner.positionZ.setTargetAtTime(m.z, t, 0.05);
    this.breath.gain.gain.setTargetAtTime(m.look === 'hunting' || m.look === 'attacking' ? 0.9 : 0.45, t, 0.3);
    const hunting = (m.look === 'hunting' || m.look === 'attacking') && dist < 30;
    this.chase.gain.gain.setTargetAtTime(hunting ? 0.12 : 0, t, hunting ? 0.3 : 2);
    this.chase.lfo.frequency.setTargetAtTime(hunting ? 2 + Math.max(0, (15 - dist) / 6) : 1, t, 0.5);
  }

  footstep(x: number, z: number, heavy: boolean, self = false) {
    if (!this.ctx) return;
    const dest = self ? this.sfx : this.panner(x, z, 0.1, heavy ? 3 : 1.5, heavy ? 45 : 25);
    if (heavy) { this.tone(dest, 'sine', 70, 35, 0.25, 0.8); this.noise(dest, 0.15, 300, 1, 0.4); }
    else this.noise(dest, 0.07, self ? 1400 : 1800, 0.7, self ? 0.08 : 0.15, 'bandpass');
  }

  heartbeat(intensity: number, dt: number) {
    if (!this.ctx || intensity < 0.2) return;
    this.heart -= dt;
    if (this.heart > 0) return;
    this.heart = 1.1 - intensity * 0.55;
    this.tone(this.sfx, 'sine', 60, 40, 0.12, 0.25 * intensity);
    this.tone(this.sfx, 'sine', 55, 38, 0.12, 0.18 * intensity, 0.18);
  }

  play(name: string, x?: number, z?: number, loud = 1) {
    if (!this.ctx) return;
    const s = useSettings.getState();
    const dest = x !== undefined && z !== undefined ? this.panner(x, z, 1.2, 2, 60) : this.sfx;
    const scare = s.reduceScares ? 0.35 : 1;
    switch (name) {
      case 'door_open': case 'door_close':
        this.tone(dest, 'sawtooth', name === 'door_open' ? 220 : 160, name === 'door_open' ? 140 : 90, 0.5, 0.06);
        this.noise(dest, 0.25, 600, 2, 0.15, 'bandpass', name === 'door_close' ? 0.4 : 0); break;
      case 'door_bang': this.noise(dest, 0.5, 400, 0.8, 0.7 * loud); this.tone(dest, 'square', 90, 40, 0.3, 0.2); break;
      case 'door_security': this.tone(dest, 'square', 880, 880, 0.1, 0.08); this.tone(dest, 'square', 1320, 1320, 0.15, 0.08, 0.12); this.noise(dest, 0.6, 200, 1, 0.3, 'lowpass', 0.2); break;
      case 'roar': this.noise(dest, 1.4, 900, 3, 0.9 * scare, 'bandpass'); this.tone(dest, 'sawtooth', 180, 60, 1.3, 0.35 * scare); break;
      case 'windup': this.tone(dest, 'sawtooth', 90, 260, 0.55, 0.3 * scare); this.noise(dest, 0.5, 1200, 2, 0.3 * scare, 'bandpass'); break;
      case 'hit': this.noise(this.sfx, 0.35, 500, 0.8, 0.9); this.tone(this.sfx, 'sine', 120, 40, 0.3, 0.6); break;
      case 'locker_rip': for (const f of [310, 467, 733]) this.tone(dest, 'triangle', f, f * 0.97, 0.9, 0.12 * loud); this.noise(dest, 0.3, 3000, 1, 0.3, 'highpass'); break;
      case 'noise_maker': for (let i = 0; i < 3; i++) this.tone(dest, 'square', 2200, 2200, 0.09, 0.12, i * 0.15); break;
      case 'generator_start': this.tone(dest, 'sawtooth', 30, 90, 3, 0.25); this.noise(dest, 3, 250, 1, 0.3); break;
      case 'power_on': this.tone(this.sfx, 'sine', 60, 120, 1.5, 0.2); this.noise(this.sfx, 0.4, 2000, 1, 0.15, 'highpass'); break;
      case 'alarm': for (let i = 0; i < 6; i++) this.tone(this.sfx, 'square', 660, 440, 0.45, 0.07, i * 0.5); break;
      case 'pickup': this.tone(this.sfx, 'sine', 600, 900, 0.12, 0.1); break;
      case 'terminal_ok': this.tone(dest, 'square', 520, 520, 0.08, 0.06); this.tone(dest, 'square', 780, 780, 0.12, 0.06, 0.1); break;
      case 'error': this.tone(this.sfx, 'square', 200, 160, 0.3, 0.08); break;
      case 'clunk': case 'switch': this.noise(dest, 0.15, 800, 1, 0.4); this.tone(dest, 'square', 120, 80, 0.15, 0.15); break;
      case 'protocol': this.tone(this.sfx, 'sine', 440, 440, 0.2, 0.1); this.tone(this.sfx, 'sine', 660, 660, 0.4, 0.1, 0.2); break;
      case 'downed': case 'death': this.tone(this.sfx, 'sine', 200, 50, 1.2, 0.2); break;
      case 'revive': case 'escaped': this.tone(this.sfx, 'sine', 330, 660, 0.6, 0.12); break;
      case 'distress': this.tone(dest, 'triangle', 500, 380, 0.8, 0.15); break;
      case 'ambient_scare': this.noise(dest, 2, 150, 4, 0.3, 'bandpass'); this.tone(dest, 'triangle', 233, 229, 2, 0.05); break;
      default:
        if (name.startsWith('adapt_')) { for (const f of [97, 151, 203]) this.tone(dest, 'triangle', f, f * 0.94, 2.2, 0.08); this.noise(dest, 1.6, 700, 6, 0.2, 'bandpass'); }
    }
  }
}

export const audio = new AudioEngine();
