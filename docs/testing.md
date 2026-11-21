# Testing

`npm test` runs Vitest on:

| Suite | What it proves |
|---|---|
| `tests/unit/shared.test.ts` | map integrity, LOS blocked by walls/closed doors, deterministic FPS-independent movement, ~12 s sprint, regen delay, no wall clipping |
| `tests/unit/memory.test.ts` | adaptation formula, a single action can never max the AI, clamping, forgetting, tier-change cues |
| `tests/integration/simulation.test.ts` | solvable seeded layouts, simultaneous pickup (Scenario D), range checks + idempotent request IDs, keycard/power doors, double revive (Bug 3), double objective completion (Bug 5), stale inputs (Bug 9), speed clamp, item drop on death/leave, full mission chain to escape, final-hunt timer, lockers |
| `tests/integration/ai.test.ts` | Rule A (no x-ray), Rule C (hidden players invisible unless seen climbing in), confirm time, **hiding adaptation** (more locker checks, never 100%), end-to-end locker check, **noise adaptation** (learned creature ignores decoys mid-chase ~50–85%, never always), 8-minute navigation soak (no teleport, never stuck >30 s) |
| `tests/multiplayer/rooms.test.ts` | real Colyseus server + `colyseus.js` clients: 4-player room by code, full room rejected, host-only start with ready check, no mid-match join, network pickup race, forged messages ignored, host migration, independent rooms, **reconnect with state restore**, end → lobby → new match without restart |

Not automated yet (GDD §51): latency/packet-loss injection (50/150/250 ms, 1–5 % loss) and browser FPS profiling on target hardware.
