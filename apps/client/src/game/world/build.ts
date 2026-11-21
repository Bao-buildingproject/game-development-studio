import * as THREE from 'three';
import { DOORS, FIXTURES, GRID, LOCKERS, MAP_H, MAP_W, TILE, Tile, WALL_HEIGHT, ZONES, ItemKind, toWorld } from '@itl/shared';

function noiseTexture(base: string, spots: string, n = 1800, size = 256, lines = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = spots;
    g.globalAlpha = Math.random() * 0.25;
    const r = Math.random() * 3;
    g.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  g.globalAlpha = 0.35;
  if (lines) {
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.strokeRect(1, 1, size - 2, size - 2);
    g.beginPath(); g.moveTo(0, size * 0.62); g.lineTo(size, size * 0.62); g.stroke();
  }
  // grime streaks
  for (let i = 0; i < 12; i++) {
    g.globalAlpha = 0.08;
    g.fillStyle = '#000';
    g.fillRect(Math.random() * size, 0, 2 + Math.random() * 6, size * Math.random());
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface ItemMesh { mesh: THREE.Object3D; kind: ItemKind }
export interface WorldHandles {
  doors: Map<string, { mesh: THREE.Mesh; open: number; vertical: boolean; base: THREE.Vector3 }>;
  fixtureLights: Map<string, THREE.Mesh>;
  zoneLights: { light: THREE.PointLight; zone: string; base: number; flicker: number }[];
  generator: THREE.Mesh;
  terminalScreen: THREE.Mesh;
  setPower(on: boolean): void;
  itemMeshes: Map<string, ItemMesh>;
  makeItem(kind: ItemKind): THREE.Object3D;
}

const ITEM_COLOR: Record<ItemKind, number> = {
  battery: 0x6b9a9d, fuse: 0xc59a58, keycard: 0x5aa0ff, medkit: 0xb7494f, noise_maker: 0xd0d06a, document: 0xe5e9ea,
};

export function buildWorld(scene: THREE.Scene): WorldHandles {
  const wallTex = noiseTexture('#3b4148', '#0b0d10', 2600, 256, true);
  wallTex.repeat.set(1, 2);
  const floorTex = noiseTexture('#2a2f33', '#000', 3000);
  floorTex.repeat.set(MAP_W / 2, MAP_H / 2);
  const ceilTex = noiseTexture('#1b1f23', '#000', 800);
  ceilTex.repeat.set(MAP_W / 3, MAP_H / 3);

  const W = MAP_W * TILE, H = MAP_H * TILE;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, H / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(W / 2, WALL_HEIGHT, H / 2);
  scene.add(ceil);

  // walls (instanced; only tiles that touch a non-wall – saves draw cost)
  const wallTiles: [number, number][] = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (GRID[y * MAP_W + x] !== Tile.Wall) continue;
    let exposed = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && GRID[ny * MAP_W + nx] !== Tile.Wall) exposed = true;
    }
    if (exposed) wallTiles.push([x, y]);
  }
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALL_HEIGHT, TILE), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0.15 }), wallTiles.length);
  const m4 = new THREE.Matrix4();
  wallTiles.forEach(([x, y], i) => { const p = toWorld(x, y); m4.makeTranslation(p.x, WALL_HEIGHT / 2, p.z); walls.setMatrixAt(i, m4); });
  walls.castShadow = true;
  walls.receiveShadow = true;
  scene.add(walls);

  // pipes along the hall ceiling for an industrial look
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.4 });
  for (const row of [12, 14]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, W - 3, 8), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(W / 2, WALL_HEIGHT - 0.25, (row + 0.5) * TILE);
    scene.add(pipe);
  }

  // doors
  const doors: WorldHandles['doors'] = new Map();
  const doorMat = { normal: 0x5b6269, security: 0x3d5a80, powered: 0x6b5a3a, exit: 0x8a2f35 } as const;
  for (const d of DOORS) {
    const p = toWorld(d.tx, d.ty);
    const geo = d.vertical ? new THREE.BoxGeometry(0.18, WALL_HEIGHT * 0.92, TILE) : new THREE.BoxGeometry(TILE, WALL_HEIGHT * 0.92, 0.18);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: doorMat[d.kind], metalness: 0.5, roughness: 0.5 }));
    mesh.position.set(p.x, WALL_HEIGHT * 0.46, p.z);
    mesh.castShadow = true;
    scene.add(mesh);
    // door frame light: shows lock state
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.25), new THREE.MeshBasicMaterial({ color: d.kind === 'normal' ? 0x335544 : 0x882222 }));
    lamp.position.set(p.x, WALL_HEIGHT - 0.1, p.z);
    scene.add(lamp);
    doors.set(d.id, { mesh, open: 0, vertical: d.vertical, base: mesh.position.clone() });
  }

  // lockers
  const lockerMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#46525a', '#111', 1500, 128, true), metalness: 0.55, roughness: 0.45 });
  for (const l of LOCKERS) {
    const p = toWorld(l.tx, l.ty);
    const box = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.8, 2.1, TILE * 0.8), lockerMat);
    box.position.set(p.x, 1.05, p.z);
    box.castShadow = true;
    scene.add(box);
    for (let i = 0; i < 4; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
      vent.position.set(p.x + l.fx * TILE * 0.41, 1.6 + i * 0.07, p.z + l.fy * TILE * 0.41);
      if (l.fx !== 0) vent.rotation.y = Math.PI / 2;
      scene.add(vent);
    }
  }

  // fixtures
  const fixtureLights = new Map<string, THREE.Mesh>();
  let generator!: THREE.Mesh, terminalScreen!: THREE.Mesh;
  for (const f of FIXTURES) {
    const p = toWorld(f.tx, f.ty);
    const status = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xb7494f }));
    if (f.kind === 'generator') {
      generator = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.95, 1.6, TILE * 0.95), new THREE.MeshStandardMaterial({ color: 0x5c5a3e, metalness: 0.6, roughness: 0.5 }));
      generator.position.set(p.x, 0.8, p.z);
      scene.add(generator);
      status.position.set(p.x, 1.7, p.z);
    } else if (f.kind === 'terminal') {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.95, 0.8, TILE * 0.7), new THREE.MeshStandardMaterial({ color: 0x2c3238 }));
      desk.position.set(p.x, 0.4, p.z);
      scene.add(desk);
      terminalScreen = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.05), new THREE.MeshBasicMaterial({ color: 0x102020 }));
      terminalScreen.position.set(p.x, 1.1, p.z + 0.15);
      scene.add(terminalScreen);
      status.position.set(p.x + 0.5, 0.9, p.z);
    } else if (f.kind === 'whiteboard') {
      const wb = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), new THREE.MeshStandardMaterial({ color: 0xd9dcd6, roughness: 0.6 }));
      wb.position.set(p.x, 1.5, p.z + TILE / 2 - 0.02);
      wb.rotation.y = Math.PI;
      scene.add(wb);
      status.visible = false;
    } else {
      // fuse box & switches mounted on the nearest wall
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.2), new THREE.MeshStandardMaterial({ color: f.kind === 'fuse_box' ? 0x6b6b4a : 0x4a5f6b, metalness: 0.5 }));
      const towardWall = f.ty === 1 ? -1 : 1;
      box.position.set(p.x, 1.4, p.z + towardWall * (TILE / 2 - 0.1));
      scene.add(box);
      status.position.set(p.x, 1.85, p.z + towardWall * (TILE / 2 - 0.1));
    }
    scene.add(status);
    fixtureLights.set(f.id, status);
  }

  // lights per zone (emergency red until power, then cold white)
  const zoneLights: WorldHandles['zoneLights'] = [];
  for (const z of ZONES) {
    if (z.id === 'west' || z.id === 'east' || z.id === 'escape' || z.id === 'archive') continue;
    const cx = ((z.x0 + z.x1 + 1) / 2) * TILE, cz = ((z.y0 + z.y1 + 1) / 2) * TILE;
    const spots = z.id === 'hall' ? [cx - 20, cx + 20] : [cx];
    for (const x of spots) {
      const light = new THREE.PointLight(0xc04030, z.id === 'reception' ? 70 : 30, 22, 1.5);
      light.position.set(x, WALL_HEIGHT - 0.3, cz);
      scene.add(light);
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.2), new THREE.MeshBasicMaterial({ color: 0x442222 }));
      fixture.position.copy(light.position).setY(WALL_HEIGHT - 0.03);
      scene.add(fixture);
      zoneLights.push({ light, zone: z.id, base: light.intensity, flicker: Math.random() * 10 });
    }
  }

  const setPower = (on: boolean) => {
    for (const zl of zoneLights) {
      const lit = on && ['hall', 'maintenance', 'laboratory', 'exit', 'reception'].includes(zl.zone);
      zl.light.color.set(lit ? 0xc8d4da : 0xc04030);
      zl.base = lit ? 90 : zl.zone === 'reception' ? 70 : 30;
    }
    (terminalScreen.material as THREE.MeshBasicMaterial).color.set(on ? 0x1d6b6b : 0x102020);
  };

  const makeItem = (kind: ItemKind): THREE.Object3D => {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: ITEM_COLOR[kind], emissive: ITEM_COLOR[kind], emissiveIntensity: 0.35, roughness: 0.5 });
    const geo =
      kind === 'document' ? new THREE.BoxGeometry(0.3, 0.01, 0.4)
      : kind === 'keycard' ? new THREE.BoxGeometry(0.2, 0.01, 0.13)
      : kind === 'battery' ? new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10)
      : kind === 'medkit' ? new THREE.BoxGeometry(0.35, 0.18, 0.25)
      : kind === 'fuse' ? new THREE.CylinderGeometry(0.06, 0.06, 0.28, 10)
      : new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    // emissive halo instead of a real light (keeps the light count low – GDD performance target)
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: ITEM_COLOR[kind], transparent: true, opacity: 0.12, depthWrite: false }));
    halo.position.y = 0.02;
    g.add(halo);
    return g;
  };

  return { doors, fixtureLights, zoneLights, generator, terminalScreen, setPower, itemMeshes: new Map(), makeItem };
}

export function makeMonster(): { group: THREE.Group; armL: THREE.Mesh; armR: THREE.Mesh; eyes: THREE.PointLight; body: THREE.Mesh } {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: 0.95, metalness: 0.05 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.5, 6, 12), skin);
  body.position.y = 1.35;
  body.scale.set(1, 1, 0.7);
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), skin);
  head.scale.set(0.8, 1.25, 1.1);
  head.position.set(0, 2.35, -0.12);
  group.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
    eye.position.set(s * 0.08, 2.4, -0.33);
    group.add(eye);
  }
  const eyes = new THREE.PointLight(0xff2a1a, 1.2, 4, 2); // the creature's single light: its eyes
  eyes.position.set(0, 2.4, -0.5);
  group.add(eyes);
  const armGeo = new THREE.CylinderGeometry(0.05, 0.035, 1.45, 8);
  armGeo.translate(0, -0.72, 0);
  const armL = new THREE.Mesh(armGeo, skin), armR = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.33, 2.0, 0); armR.position.set(0.33, 2.0, 0);
  group.add(armL, armR);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 1.0, 8), skin);
    leg.position.set(s * 0.15, 0.5, 0);
    group.add(leg);
  }
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return { group, armL, armR, eyes, body };
}

export function makeTeammate(color: string) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 6, 12), mat);
  body.position.y = 0.95;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc9b7a0, roughness: 0.8 }));
  head.position.y = 1.65;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  visor.position.set(0, 1.68, -0.17);
  g.add(visor);
  const spot = new THREE.SpotLight(0xfff2d6, 0, 18, Math.PI / 7, 0.5, 1.5);
  spot.position.set(0.2, 1.45, -0.2);
  spot.target.position.set(0.2, 1.3, -5);
  g.add(spot, spot.target);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return { group: g, spot, body };
}
