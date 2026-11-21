import * as THREE from 'three';
import {
  CHARACTERS, CROUCH_EYE_HEIGHT, DOORS, DT, EYE_HEIGHT, FIXTURES, GameEvent, INTERACT_RANGE, INTERP_DELAY_MS, ITEM_LABEL, InputMsg, LOCKERS,
  MoveInput, MoveState, PlayerView, Snapshot, TILE, lineOfSight, stepMovement, toWorld,
} from '@itl/shared';
import { net } from '../network/net';
import { audio } from '../audio/audio';
import { InputState } from '../player/input';
import { WorldHandles, buildWorld, makeMonster, makeTeammate } from '../world/build';
import { useUI } from '../../state';
import { useSettings } from '../../settings';

interface Target { entityId: string; action: string; label: string; hold: boolean; keypad?: boolean }

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private flashlight: THREE.SpotLight;
  private hemi: THREE.HemisphereLight;
  private world: WorldHandles;
  private input = new InputState();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private seq = 0;
  private pending: (MoveInput & { flashlight: boolean })[] = [];
  private local: MoveState | null = null;
  private renderOffset = new THREE.Vector2();
  private flashlightOn = false;
  private remotes = new Map<string, ReturnType<typeof makeTeammate>>();
  private monster = makeMonster();
  private monsterPrev = { x: 0, z: 0, step: 0 };
  private stepAcc = 0;
  private bob = 0;
  private shake = 0;
  private target: Target | null = null;
  private holdActive = false;
  private hudTimer = 0;
  private unsubs: (() => void)[] = [];
  private lastPower = false;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x020304);
    this.scene.fog = new THREE.FogExp2(0x030405, 0.06);
    this.camera = new THREE.PerspectiveCamera(useSettings.getState().fov, 1, 0.05, 80);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.flashlight = new THREE.SpotLight(0xfff1d0, 0, 22, Math.PI / 6.5, 0.45, 1.4);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.position.set(0.18, -0.15, 0);
    this.flashlight.target.position.set(0, -0.2, -5);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.hemi = new THREE.HemisphereLight(0x5a6670, 0x0b0c0e, 0.12);
    this.scene.add(this.hemi);
    this.world = buildWorld(this.scene);
    this.monster.group.visible = false;
    this.scene.add(this.monster.group);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.input.attach();
    this.unsubs.push(net.onEvent((e) => this.onEvent(e)));
    this.unsubs.push(net.onSnapshot((s) => this.onSnapshot(s)));
    this.unsubs.push(useSettings.subscribe((s) => { this.camera.fov = s.fov; this.camera.updateProjectionMatrix(); }));
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  private onLockChange = () => {
    const ui = useUI.getState();
    if (!document.pointerLockElement && ui.screen === 'game' && !ui.keypad && !ui.doc && !ui.showMap && !ui.showInventory) ui.set({ paused: true });
  };

  requestLock() {
    audio.init();
    this.canvas.requestPointerLock?.();
    useUI.getState().set({ paused: false });
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  start() {
    this.last = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.unsubs.forEach((u) => u());
    this.renderer.dispose();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }

  private me(s: Snapshot | null): PlayerView | undefined {
    const id = useUI.getState().sessionId;
    return s?.players.find((p) => p.id === id);
  }

  // ───────── server reconciliation (GDD §25) ─────────
  private onSnapshot(s: Snapshot) {
    const me = this.me(s);
    if (!me) return;
    const doorOpen = (id: string) => !!s.doors[id];
    const before = this.local ? { x: this.local.x, z: this.local.z } : null;
    let st: MoveState = { x: me.x, z: me.z, stamina: s.self.stamina, staminaDelay: s.self.staminaDelay, mode: me.mode as MoveState['mode'] };
    this.pending = this.pending.filter((p) => p.seq > s.self.lastSeq);
    if (me.status === 'alive' || me.status === 'downed') {
      for (const p of this.pending) st = stepMovement(st, p, DT, doorOpen, { downed: me.status === 'downed' || !!s.self.hold });
    }
    if (before) {
      const err = Math.hypot(st.x - before.x, st.z - before.z);
      if (err < 1.5) this.renderOffset.add(new THREE.Vector2(before.x - st.x, before.z - st.z)); // smooth small corrections
      else this.renderOffset.set(0, 0); // snap on large divergence
    }
    this.local = st;
    if (s.objective.powerOn !== this.lastPower) { this.lastPower = s.objective.powerOn; this.world.setPower(s.objective.powerOn); audio.setPower(s.objective.powerOn); }
  }

  private onEvent(e: GameEvent) {
    const ui = useUI.getState();
    if (e.sound) audio.play(e.sound, e.x, e.z, e.loud ?? 1);
    if (e.text && (e.kind === 'sound' || e.kind === 'adapted' || e.kind === 'attack_windup' || e.kind === 'door' || e.kind === 'locker_checked' || e.kind === 'subtitle')) {
      if (useSettings.getState().subtitles) ui.addSubtitle(e);
    } else if (e.text) {
      ui.addNotice(e.text, e.kind === 'downed' || e.kind === 'died' || e.kind === 'final_hunt' ? 'bad' : e.kind === 'revived' || e.kind === 'escaped' || e.kind === 'power_on' ? 'good' : 'info');
    }
    if (e.kind === 'document' && e.title) { document.exitPointerLock?.(); ui.set({ doc: { title: e.title, body: e.body ?? '' } }); }
    if (e.kind === 'sound' && e.sound === 'hit') {
      const me = this.me(net.latest);
      if (me && e.x !== undefined && Math.hypot(e.x - me.x, (e.z ?? 0) - me.z) < 1) { ui.set({ hitFlash: 1 }); this.shake = useSettings.getState().reduceShake ? 0 : 0.35; }
    }
    if (e.kind === 'sound' && e.sound === 'roar' && !useSettings.getState().reduceShake) this.shake = Math.max(this.shake, 0.15);
  }

  // ───────── per-frame ─────────
  private frame(dt: number) {
    const ui = useUI.getState();
    const snap = net.latest;
    const me = this.me(snap);
    const playing = ui.screen === 'game' && !ui.paused && !ui.keypad && !ui.doc;
    if (playing && this.input.locked) {
      this.camera.rotation.y = this.input.yaw;
      this.camera.rotation.x = this.input.pitch;
    }
    this.handleActions(playing, me, snap);
    // fixed 30 Hz input + prediction (FPS independent – Bug 8)
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.fixedStep(playing, me, snap);
    }
    this.renderOffset.multiplyScalar(Math.pow(0.0001, dt));
    this.updateView(dt, me, snap);
    this.updateRemotes(snap, dt);
    this.updateWorld(snap, dt);
    this.updateTarget(me, snap);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && snap) {
      this.hudTimer = 0.1;
      const fearDecay = Math.max(0, ui.hitFlash - 0.25);
      ui.set({ hud: snap, hitFlash: fearDecay });
    }
    this.renderer.toneMappingExposure = useSettings.getState().brightness * 1.1;
    this.hemi.intensity = 0.4 * useSettings.getState().brightness;
    this.renderer.render(this.scene, this.camera);
  }

  private fixedStep(playing: boolean, me: PlayerView | undefined, snap: Snapshot | null) {
    if (!snap || !me || !this.local) return;
    let mx = 0, mz = 0;
    if (playing) {
      if (this.input.held('forward')) mz += 1;
      if (this.input.held('back')) mz -= 1;
      if (this.input.held('right')) mx += 1;
      if (this.input.held('left')) mx -= 1;
    }
    const hidden = me.status === 'hidden';
    if (hidden || me.status === 'dead' || me.status === 'escaped' || snap.self.hold) { mx = 0; mz = 0; }
    const inp: InputMsg = {
      seq: ++this.seq, mx, mz, yaw: this.input.yaw, pitch: this.input.pitch, run: playing && this.input.held('run'), crouch: playing && this.input.held('crouch'),
      interactHeld: playing && this.holdActive && this.input.held('interact'), flashlight: this.flashlightOn,
    };
    if (!inp.interactHeld) this.holdActive = false;
    net.sendInput(inp);
    if (me.status === 'alive' || me.status === 'downed') {
      const prevX = this.local.x, prevZ = this.local.z;
      this.local = stepMovement(this.local, inp, DT, (id) => !!snap.doors[id], { downed: me.status === 'downed' || !!snap.self.hold });
      this.pending.push(inp);
      if (this.pending.length > 90) this.pending.shift();
      const moved = Math.hypot(this.local.x - prevX, this.local.z - prevZ);
      this.stepAcc += moved;
      this.bob += moved * 3.2;
      const stride = this.local.mode === 'run' ? 1.6 : 1.1;
      if (this.stepAcc > stride && this.local.mode !== 'crouch') { this.stepAcc = 0; audio.footstep(0, 0, false, true); }
    }
  }

  private send(t: Target) {
    if (t.keypad) { document.exitPointerLock?.(); useUI.getState().set({ keypad: true }); return; }
    void net.interact(t.entityId, t.action).then((r) => {
      if (!r.ok) {
        if (r.reason === 'CODE_REQUIRED') { document.exitPointerLock?.(); useUI.getState().set({ keypad: true }); return; }
        useUI.getState().set({ invalid: { text: r.reason ?? 'Not possible', at: performance.now() } });
        audio.play('error');
      } else if (t.action === 'pickup') audio.play('pickup');
    });
    if (t.hold) this.holdActive = true;
  }

  private handleActions(playing: boolean, me: PlayerView | undefined, snap: Snapshot | null) {
    const ui = useUI.getState();
    if (!playing || !me || !snap) { this.input.clearPressed(); return; }
    if (this.input.consume('flashlight')) { this.flashlightOn = !this.flashlightOn; audio.play('switch'); }
    if (this.input.slotPressed !== null) { ui.set({ selectedSlot: this.input.slotPressed }); this.input.slotPressed = null; }
    if (this.input.consume('interact') && this.target) this.send(this.target);
    if (this.input.consume('use')) void net.useItem(ui.selectedSlot).then((r) => !r.ok && ui.set({ invalid: { text: r.reason ?? '', at: performance.now() } }));
    if (this.input.consume('drop')) void net.dropItem(ui.selectedSlot).then((r) => !r.ok && ui.set({ invalid: { text: r.reason ?? '', at: performance.now() } }));
    if (this.input.consume('distress')) void net.interact('self', 'distress');
    if (this.input.consume('inventory')) ui.set({ showInventory: !ui.showInventory });
    if (this.input.consume('map')) ui.set({ showMap: !ui.showMap });
    this.input.consume('talk'); // proximity voice chat is post-MVP (GDD §27)
  }

  private updateTarget(me: PlayerView | undefined, snap: Snapshot | null) {
    let t: Target | null = null;
    if (me && snap) {
      const doorOpen = (id: string) => !!snap.doors[id];
      if (me.status === 'hidden' && snap.self.lockerId) t = { entityId: snap.self.lockerId, action: 'exit', label: 'Leave locker', hold: false };
      else if (me.status === 'downed') t = snap.self.selfRevives > 0 ? { entityId: 'self', action: 'self_revive', label: `Hold to get up (${snap.self.selfRevives} left) · H to call for help`, hold: true } : null;
      else if (me.status === 'alive' && this.local) {
        const px = this.local.x, pz = this.local.z;
        const fx = -Math.sin(this.input.yaw), fz = -Math.cos(this.input.yaw);
        let best: { t: Target; score: number } | null = null;
        const consider = (x: number, z: number, tgt: Target, extra = 0) => {
          const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
          if (d > INTERACT_RANGE + extra) return;
          const cos = d > 0.3 ? (dx * fx + dz * fz) / d : 1;
          if (cos < 0.75) return;
          if (!lineOfSight(px, pz, x, z, doorOpen)) return;
          const score = d * (2 - cos);
          if (!best || score < best.score) best = { t: tgt, score };
        };
        for (const it of snap.items) consider(it.x, it.z, { entityId: it.id, action: 'pickup', label: it.kind === 'document' ? 'Read research document' : `Pick up ${ITEM_LABEL[it.kind]}`, hold: false });
        for (const d of DOORS) {
          const p = toWorld(d.tx, d.ty);
          const open = snap.doors[d.id];
          const label = d.kind === 'exit' ? 'Hold: open Emergency Exit' : d.kind === 'security' && !open ? 'Security door (Keycard)' : open ? 'Close door' : 'Open door';
          consider(p.x, p.z, { entityId: d.id, action: 'use', label, hold: d.kind === 'exit' });
        }
        for (const l of LOCKERS) { const p = toWorld(l.tx, l.ty); consider(p.x, p.z, { entityId: l.id, action: 'enter', label: 'Hide in locker', hold: false }); }
        for (const f of FIXTURES) {
          const p = toWorld(f.tx, f.ty);
          const st = snap.fixtures[f.id];
          const label =
            f.kind === 'fuse_box' ? (st === 'installed' ? 'Fuse box (installed)' : 'Install Fuse')
            : f.kind === 'generator' ? (st === 'off' ? 'Start generator' : `Generator (${st})`)
            : f.kind === 'terminal' ? (st === 'locked' ? 'Enter terminal code' : `Terminal (${st})`)
            : f.kind === 'whiteboard' ? 'Read whiteboard'
            : st === 'armed' ? `${f.label} (armed)` : `Arm ${f.label}`;
          consider(p.x, p.z, { entityId: f.id, action: 'use', label, hold: false, keypad: f.kind === 'terminal' && st === 'locked' }, f.solid ? 0.5 : 0);
        }
        for (const p of snap.players) if (p.status === 'downed' && p.id !== me.id) consider(p.x, p.z, { entityId: `player:${p.id}`, action: 'revive', label: `Hold: revive ${p.name} (Medkit)`, hold: true });
        t = best ? (best as { t: Target }).t : null;
      }
    }
    this.target = t;
    const cur = useUI.getState().prompt;
    const next = t ? { text: t.label, hold: t.hold } : null;
    if (cur?.text !== next?.text) useUI.getState().set({ prompt: next });
  }

  private updateView(dt: number, me: PlayerView | undefined, snap: Snapshot | null) {
    if (!me || !snap) {
      // attract camera
      this.camera.position.set(21 * TILE, 1.7, 13.5 * TILE);
      return;
    }
    if (me.status === 'hidden' && snap.self.lockerId) {
      const l = LOCKERS.find((x) => x.id === snap.self.lockerId)!;
      const p = toWorld(l.tx, l.ty);
      this.camera.position.set(p.x + l.fx * 0.25, 1.55, p.z + l.fy * 0.25);
      const yaw = Math.atan2(-l.fx, -l.fy);
      this.camera.rotation.y = yaw + Math.max(-0.5, Math.min(0.5, this.input.yaw - yaw));
      this.flashlight.intensity = 0;
    } else {
      const lx = (this.local?.x ?? me.x) + this.renderOffset.x, lz = (this.local?.z ?? me.z) + this.renderOffset.y;
      const crouch = this.local?.mode === 'crouch';
      const eye = me.status === 'downed' ? 0.45 : me.status === 'dead' ? 0.3 : crouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
      const bobAmt = useSettings.getState().reduceShake ? 0.01 : 0.035;
      const sh = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.set(lx + sh, THREE.MathUtils.lerp(this.camera.position.y || eye, eye, Math.min(1, dt * 10)) + Math.sin(this.bob) * bobAmt, lz + sh);
      const on = this.flashlightOn && snap.self.battery > 0 && me.status === 'alive';
      const flick = snap.self.battery < 15 ? (Math.random() < 0.08 ? 0.2 : 1) : 1;
      this.flashlight.intensity = on ? 38 * flick : 0;
    }
    audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.camera.rotation.y);
  }

  private updateRemotes(snap: Snapshot | null, dt: number) {
    if (!snap) return;
    const myId = useUI.getState().sessionId;
    const renderAt = performance.now() - INTERP_DELAY_MS;
    const buf = net.snapshots;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = buf.length - 1; i > 0; i--) if (buf[i - 1].at <= renderAt) { a = buf[i - 1]; b = buf[i]; break; }
    const k = b && a && b.at > a.at ? Math.max(0, Math.min(1, (renderAt - a.at) / (b.at - a.at))) : 1;
    const seen = new Set<string>();
    for (const p of b?.s.players ?? []) {
      if (p.id === myId) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        r = makeTeammate(CHARACTERS.find((c) => c.id === p.character)?.color ?? '#999');
        this.remotes.set(p.id, r);
        this.scene.add(r.group);
      }
      const pa = a.s.players.find((x) => x.id === p.id) ?? p;
      const x = THREE.MathUtils.lerp(pa.x, p.x, k), z = THREE.MathUtils.lerp(pa.z, p.z, k);
      const moved = Math.hypot(x - r.group.position.x, z - r.group.position.z);
      if (moved > 0.02 && moved < 1 && p.mode === 'run') audio.footstep(x, z, false);
      r.group.position.set(x, 0, z);
      r.group.rotation.y = p.yaw;
      r.group.visible = p.status !== 'hidden' && p.status !== 'escaped';
      r.body.scale.y = p.status === 'downed' || p.status === 'dead' ? 0.35 : p.mode === 'crouch' ? 0.7 : 1;
      r.spot.intensity = p.flashlight ? 25 : 0;
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { this.scene.remove(r.group); this.remotes.delete(id); }

    // monster (only present in snapshots when near / in sight – server-side culling)
    const mb = b?.s.monster, ma = a?.s.monster ?? mb;
    const g = this.monster.group;
    if (mb && ma) {
      const x = THREE.MathUtils.lerp(ma.x, mb.x, k), z = THREE.MathUtils.lerp(ma.z, mb.z, k);
      const sp = Math.hypot(x - this.monsterPrev.x, z - this.monsterPrev.z) / Math.max(dt, 1e-3);
      this.monsterPrev.step += sp * dt;
      if (g.visible && this.monsterPrev.step > 1.3) { this.monsterPrev.step = 0; audio.footstep(x, z, true); }
      this.monsterPrev.x = x; this.monsterPrev.z = z;
      g.visible = true;
      g.position.set(x, 0, z);
      let dy = mb.yaw - g.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      g.rotation.y += dy * Math.min(1, dt * 8);
      const t = performance.now() / 1000;
      const swing = Math.min(1, sp / 3) * Math.sin(t * 9) * 0.6;
      const raise = mb.look === 'attacking' ? -2.2 : mb.look === 'checking' ? -1.2 : 0;
      this.monster.armL.rotation.x = raise + swing;
      this.monster.armR.rotation.x = raise - swing;
      this.monster.body.rotation.x = mb.look === 'hunting' ? -0.25 : 0;
      this.monster.eyes.intensity = mb.look === 'hunting' || mb.look === 'attacking' ? 2.5 : 1;
      const d = Math.hypot(x - this.camera.position.x, z - this.camera.position.z);
      audio.updateCreature({ x, z, look: mb.look }, d);
      const fear = Math.max(0, Math.min(1, (14 - d) / 12)) * (mb.look === 'hunting' || mb.look === 'attacking' ? 1 : 0.6);
      useUI.getState().fear !== fear && useUI.setState({ fear });
      audio.heartbeat(fear, dt);
    } else {
      g.visible = false;
      audio.updateCreature(null, 99);
      if (useUI.getState().fear > 0) useUI.setState({ fear: Math.max(0, useUI.getState().fear - dt) });
    }
  }

  private updateWorld(snap: Snapshot | null, dt: number) {
    if (!snap) return;
    for (const d of DOORS) {
      const h = this.world.doors.get(d.id)!;
      const target = snap.doors[d.id] ? 1 : 0;
      h.open += (target - h.open) * Math.min(1, dt * 6);
      const off = h.open * TILE * 0.95;
      h.mesh.position.set(h.base.x + (h.vertical ? 0 : off), h.base.y, h.base.z + (h.vertical ? off : 0));
      h.mesh.visible = h.open < 0.98;
    }
    const live = new Set(snap.items.map((i) => i.id));
    for (const [id, im] of this.world.itemMeshes) if (!live.has(id)) { this.scene.remove(im.mesh); this.world.itemMeshes.delete(id); }
    const t = performance.now() / 1000;
    for (const it of snap.items) {
      let im = this.world.itemMeshes.get(it.id);
      if (!im) { im = { mesh: this.world.makeItem(it.kind), kind: it.kind }; this.world.itemMeshes.set(it.id, im); this.scene.add(im.mesh); }
      im.mesh.position.set(it.x, 0.35 + Math.sin(t * 2 + it.x) * 0.05, it.z);
      im.mesh.rotation.y = t * 0.8;
    }
    for (const zl of this.world.zoneLights) {
      zl.flicker += dt;
      const f = Math.sin(zl.flicker * 13) > 0.96 || (Math.random() < 0.004) ? 0.25 : 1;
      zl.light.intensity = zl.base * f;
    }
    const st = (id: string) => snap.fixtures[id];
    const color = (id: string, on: boolean) => ((this.world.fixtureLights.get(id)!.material as THREE.MeshBasicMaterial).color.set(on ? 0x67d18a : 0xb7494f));
    color('fuse_box', st('fuse_box') === 'installed');
    color('generator', st('generator') === 'running');
    color('terminal', st('terminal') === 'done' || st('terminal') === 'downloading');
    color('switch_a', st('switch_a') === 'armed');
    color('switch_b', st('switch_b') === 'armed');
    if (st('generator') !== 'off') this.world.generator.position.x += (Math.random() - 0.5) * 0.01 - (this.world.generator.position.x - toWorld(40, 6).x) * 0.2;
  }
}
