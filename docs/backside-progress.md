# Two-sided PCB implementation progress

Branch: `codex/two-sided-pcb`; base: `208d8b8` (latest main at start).
Previous checkpoint: `1d125b1`. Latest checkpoint: the commit containing this
document (`git log -1`).

## Completed

- Map contract supports optional `back` metadata without changing legacy maps.
- Importer extracts bottom component bounds from actual STEP substrate bottom.
- Bottom coordinates are `(STEP X-cx, substrate bottom-STEP Z, STEP Y-cy)`.
  Front coordinates remain `(STEP X-cx, STEP Z-substrate top, cy-STEP Y)`.
- Back eligibility requires 12 parts and summed footprints >=1% board area.
- Four extraction tests pass; `npx tsc --noEmit` passes.
- Shared movement selects independent backside collisions and supports edge
  placement, mirrored physical Z, highest-component clearance, and cooldown.
- Focused extraction, transition, and existing game tests: 31 passing.
- Physics integration now turns inward at X edges, preserves inward heading at
  Z edges, and clamps to board bounds during cooldown. All 15 transition/combat
  helper tests pass, including 90 consecutive held-forward ticks at each edge.
- Movement protocol bumped to 4 for side and heading state.
- Multiplayer milestone: schema/server preserve side, cooldown and heading;
  respawns reset to front; side filters protect shooting and ammo collection.
  Real Colyseus two-client round-trip/combat test passes (5 seconds).

## Changed files

`shared/game.ts`, `tools/board-surfaces.ts`, `tools/import-step.ts`,
`tests/board-surfaces.test.ts`, `tests/side-transitions.test.ts`, and this document.

## Remaining / exact next steps

1. Regenerate BMS once with the revised importer, verify bottom geometry/count.
2. Integrate heading adjustment / inward placement with cooldown to prevent
   repeated held-outward-input edge loops. Transition helpers and edge tests
   exist, but sustained-movement loop prevention still needs integration tests.
3. Multiplayer integration is implemented; run final full-suite verification.
4. Rotate the existing model for backside rendering, hide opposite-side players,
   add FRONT/BACK HUD indicator, keep camera upright.
5. Run full tests/build and real-browser BMS checks; document behavior; open PR.

## Known limitations

Generated BMS map regeneration is running. Physics and server integration are
implemented; renderer/prediction edits are being verified next. Real BMS browser
verification and the final full suite remain pending.
