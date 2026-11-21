# Architecture

```
Browser client (apps/client)                         Game server (apps/server)
┌────────────────────────────┐   player_input 30Hz   ┌──────────────────────────────────────┐
│ InputState (rebindable)    │ ────────────────────▶ │ HuntRoom (Colyseus)                  │
│ prediction: stepMovement() │   interact/use/drop   │  lobby, ready, host, code, reconnect │
│ reconciliation + offset    │ ────────────────────▶ │  setSimulationInterval 30 Hz         │
│ interpolation (120 ms)     │ ◀──────────────────── │ GameSimulation (one per match)       │
│ Three.js renderer, audio   │  world_snapshot 15Hz  │  players, items, doors, objectives   │
│ React HUD / menus          │  game_event (unique id)│  MonsterBrain ← perception only      │
└────────────────────────────┘  interaction_result   │  AdaptiveMemory · Director           │
                                                     └──────────────────────────────────────┘
```

* **Shared code** (`packages/shared`): the map, collision, line of sight and `stepMovement` are imported by both sides, so prediction matches the authority and frame rate never changes speed (Bug 8).
* **Authority**: the client sends only intents. Health, inventory, doors, objectives, AI and match results exist only on the server (GDD §21). Unknown messages are ignored and inputs are clamped.
* **Per-client snapshots**: the creature's position is sent only when it is within 28 m or in line of sight. Its behavioural memory and current target are never sent (GDD §43).
* **AI isolation**: `MonsterBrain` gets a narrow `MonsterWorld` interface. Player positions reach it only through `see()` / `hear()` in `ai/perception.ts` (GDD §15, Rule C). Attacks are validated by the simulation against true positions and line of sight (Bug 4).
* **Room isolation**: every room owns its simulation. There is no global gameplay state, and returning to the lobby discards the previous simulation (GDD §47).
* **Reconnection**: identity is the Colyseus `sessionId` plus a reconnection token in `sessionStorage`. The seat is held 60 s, during which the character is frozen but still vulnerable. If the window expires, its items are dropped so missions remain completable.
* **Single port**: in development Express hosts Vite in middleware mode next to the Colyseus WebSocket transport, which works with Codespaces port forwarding.
