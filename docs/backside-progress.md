# Two-sided PCB implementation progress

Branch: `codex/two-sided-pcb`; base: `208d8b8` (latest main at start).
Latest checkpoint: the commit containing this document (`git log -1`).

## Completed

- Map contract supports optional `back` metadata without changing legacy maps.
- Importer extracts bottom component bounds from actual STEP substrate bottom.
- Bottom coordinates are `(STEP X-cx, substrate bottom-STEP Z, STEP Y-cy)`.
  Front coordinates remain `(STEP X-cx, STEP Z-substrate top, cy-STEP Y)`.
- Back eligibility requires 12 parts and summed footprints >=1% board area.
- Four extraction tests pass; `npx tsc --noEmit` passes.

## Changed files

`shared/game.ts`, `tools/board-surfaces.ts`, `tools/import-step.ts`,
`tests/board-surfaces.test.ts`, and this document.

## Remaining / exact next steps

1. Regenerate BMS once with the revised importer, verify bottom geometry/count.
2. Add deterministic edge transitions and safe placement to shared movement;
   cover all four edges in both directions, cooldown, and legacy falling.
3. Synchronize side and cooldown, update prediction/reconciliation and protocol,
   restrict shooting and pickups by side, add multiplayer tests.
4. Rotate the existing model for backside rendering, hide opposite-side players,
   add FRONT/BACK HUD indicator, keep camera upright.
5. Run full tests/build and real-browser BMS checks; document behavior; open PR.

## Known limitations

Feature is not yet playable. Generated BMS map has not yet been regenerated.
No physics, networking, or rendering behavior has changed at this checkpoint.
Milestone 1 foundation is checkpointed; real-map verification is pending.
