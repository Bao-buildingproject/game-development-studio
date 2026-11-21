# GDD v1.0 → implementation map

| GDD | Status | Where |
|---|---|---|
| §8 Controls, rebinding, Pointer Lock notice | ✅ | `client/src/settings.ts`, `ui/Menu.tsx`, `ui/SettingsPanel.tsx` |
| §9 Attributes (2.8/4.5/1.5 m/s, 12 s sprint, 8/s regen, 1.5 s delay) | ✅ | `shared/constants.ts`, `shared/movement.ts` |
| §10 Server-validated interaction | ✅ | `server/simulation/game.ts#interact` |
| §11 Items (no guns) | ✅ | flashlight, battery, fuse, keycard, medkit, noise maker, documents |
| §12 Downed/revive (45 s, 6 s, 40 HP, 2 downs, solo self-revive) | ✅ | `game.ts` |
| §14 AI state machine + timeouts | ✅ | `server/ai/monster.ts` |
| §15 Perception (vision, hearing, spatial clues) | ✅ | `server/ai/perception.ts` (voice hearing: post-MVP with voice chat) |
| §16–17 Behavioural memory & scoring | ✅ | `server/ai/memory.ts` |
| §18 Learning from hiding | ✅ | `MonsterBrain.planSearch`, tests |
| §19 Fairness rules A–H | ✅ | perception, no teleport, telegraphed attacks, cues on adaptation, chase cap 40 s |
| §20 AI Director | ✅ | `server/ai/director.ts` |
| §21–26 Authority, lobby, sync, tick rates, prediction, reconnection | ✅ | `server/rooms/HuntRoom.ts`, `client/src/game/*` |
| §27 Proximity voice chat | ⏳ post-MVP (V key reserved) | |
| §28–30 Map (MVP 5 zones + loops) | ✅ | `shared/map.ts` (~2,200 m² gross; tune after playtests) |
| §31 Missions 1–3 + escape | ✅ | `game.ts#stepObjectives` |
| §33 Seeded variation + solvability | ✅ | `server/simulation/spawn.ts` |
| §35–36 Sound layers, Scare Director | ✅ | `client/src/game/audio/audio.ts`, `Director.wantsAmbientScare` |
| §37–41 Visual direction, menu, lobby, HUD, accessibility | ✅ | `client/src/ui/*` |
| §50 Bugs 1–10 | ✅ | see `docs/testing.md` |
| §52 Security (validation, rate limits, sanitation, no secret AI data) | ✅ / partial | room codes are 6 chars from a 32-symbol alphabet; per-IP join throttling in `onAuth` |
| §55 FPS 60 on target PC | ⚠ not measured (headless CI has no GPU) | |
