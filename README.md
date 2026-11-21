# IT LEARNS: THE HUNT

**Project SYNAPSE** · Co-operative psychological survival horror · Desktop web · 1–4 players · First-person 3D

> *The monster learns from your habits. Survival depends on changing them.*

Up to four emergency responders are sealed inside SYNAPSE facility B4. They restore power, recover research data, unlock the emergency protocol and escape, while Subject 47 hunts them. The creature knows only what it has **seen or heard**, but it remembers. Hide in lockers too often and it starts checking lockers. Keep using the same decoy and it stops falling for it.

## Run it

You need Node.js 20 or newer. In GitHub Codespaces the dev container installs everything and forwards port 2567.

```bash
npm install
npm run dev          # one port for game server + client: http://localhost:2567
```

Open the page, enter a name and press **PLAY** for a solo run, or **CREATE ROOM** and share the 6-letter code. Friends join with **JOIN ROOM**.

```bash
npm test             # unit + integration + AI + real-network multiplayer tests
npm run build        # production client bundle (apps/client/dist)
npm start            # production server (serves the built client), PORT=2567 by default
```

Set `DEBUG_AI=1` to print the creature's state changes, observations and adaptations to the server console.

## Controls

| Input | Action |
|---|---|
| W A S D / Mouse | Move / look (Pointer Lock – click the game) |
| Shift / Ctrl or C | Run / crouch |
| E | Interact (hold for revive and the emergency exit) |
| F | Flashlight |
| 1–4, Q, G | Select slot, use item, drop item |
| Tab / M | Backpack / explored map |
| H | Call for help while downed |
| Esc | Pause & settings (all keys can be rebound) |

## What is implemented (MVP – GDD §53)

- Browser 3D first-person game (Three.js) with a procedurally textured map of SYNAPSE B4: Reception, Laboratory, Archive, Maintenance, Containment and Emergency Exit, plus a central hall and two corridors that form escape loops.
- **Server-authoritative multiplayer** (Colyseus): rooms with 6-character codes, ready/host-only start, host migration, no joining mid-match, **60 s reconnection** with full state restore, and play again without restarting the server.
- 30 Hz fixed-timestep simulation with 15 Hz per-client snapshots. Client-side prediction uses the *same* shared movement code, with server reconciliation and 120 ms interpolation of remote players and the creature.
- Interactions validated on the server (distance, line of sight, items, state machines). Atomic item pickup, transactional revive, idempotent objectives and request IDs, and sequenced inputs with replay protection and rate limits.
- Three missions and a final escape: Restore Power (fuse → generator spin-up), Recover Research Data (keycard → whiteboard code → terminal download you must defend), Emergency Protocol (two override switches inside a sync window: 90 s solo / 25 s co-op), then a 150 s Final Hunt to the evacuation lift.
- Seeded layout for every match (fuse, keycard, medkits, batteries, noise makers, documents, terminal code, door states), with a solvability check.
- Health 100, stamina, 4-slot inventory and a flashlight with a battery. Downed for 45 s, revived with a Medkit (6 s hold, 40 HP), at most 2 downs, solo self-revives.
- **Subject 47 AI** on the server only:
  - Perception: limited field of view and range, line of sight, light and motion, time needed to confirm a target, hearing muffled by walls.
  - State machine: DORMANT / PATROL / SUSPICIOUS / INVESTIGATE / SEARCH / CHASE / ADAPT / RECOVER / FINAL_HUNT, with timeouts and recovery when stuck.
  - Behavioural memory scored as `clamp(prev × decay + weight × confidence, 0, 100)`.
  - Adaptations learned: **hiding in lockers**, **noise-maker decoys**, repeated routes, flashlight use and rescue patterns. Each comes with an audible or subtitled cue and always has counterplay.
  - A separate AI Director controls pacing (rest periods, how strongly it leans toward the mission area), and a Scare Director limits ambient events.
- Procedural WebAudio (no assets): ambience, positional HRTF creature breathing and footsteps, chase music and a heartbeat, with subtitles.
- HUD (health, stamina, battery, inventory, objective, teammates, connection state), explored-areas map, document reader, terminal keypad, pause menu.
- Settings: sensitivity, FOV, brightness, separate volume channels, subtitles, reduced shake, reduced scares, key rebinding.
- A results screen with the ending, each player's fate, and *what Subject 47 learned about you*.

**Not in this MVP (by design, GDD §66 / §27):** proximity voice chat, accounts and persistence, more maps or monsters, matchmaking.

## Structure

```text
apps/client/   React UI + Three.js game (renderer, player input/prediction, world, audio, network)
apps/server/   Colyseus room, authoritative simulation, AI (perception, memory, monster FSM, director), security
packages/shared/  constants, map, line of sight, movement (shared by client prediction & server), protocol types
tests/         unit · integration (simulation & AI) · multiplayer (real Colyseus server + 4 clients)
docs/          architecture.md · testing.md · gdd-coverage.md
```
