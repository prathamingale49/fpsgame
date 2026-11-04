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

## Changed files

`shared/game.ts`, `tools/board-surfaces.ts`, `tools/import-step.ts`,
`tests/board-surfaces.test.ts`, `tests/side-transitions.test.ts`, and this document.

## Remaining / exact next steps

1. Regenerate BMS once with the revised importer, verify bottom geometry/count.
2. Integrate heading adjustment / inward placement with cooldown to prevent
   repeated held-outward-input edge loops. Transition helpers and edge tests
   exist, but sustained-movement loop prevention still needs integration tests.
3. Synchronize side and cooldown, update prediction/reconciliation and protocol,
   restrict shooting and pickups by side, add multiplayer tests.
4. Rotate the existing model for backside rendering, hide opposite-side players,
   add FRONT/BACK HUD indicator, keep camera upright.
5. Run full tests/build and real-browser BMS checks; document behavior; open PR.

## Known limitations

Feature is not yet playable. Generated BMS map has not yet been regenerated.
Legacy map behavior is unchanged. New side fields are currently optional and
are not synchronized by the server. Do not enable `back` on a deployed map yet:
server motion reconstruction currently drops side/cooldown, and the renderer
does not switch surfaces. Heading preservation and held-input loop prevention
remain unresolved. Milestones 1 and 2 foundations are checkpointed; both need
integration verification before they can be considered complete.
