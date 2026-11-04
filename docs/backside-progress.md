# Two-sided PCB implementation progress

Branch: `codex/two-sided-pcb`; base: `208d8b8` (latest main at start).
Previous checkpoint: `71e7221`. Latest checkpoint: the commit containing this
document (`git log -1`).

## Completed

### Through-hole collision follow-up

- Root cause: component-level mesh union used the above-board connector housing
  footprint for backside boxes, spanning empty space between protrusions.
- Extraction now clips triangles below the substrate and welds vertices to
  identify disconnected regions, including separate pins in a single mesh.
  Only offline import code changes; gameplay still uses ordinary AABBs.
- Bottom-mounted component boxes and all front boxes remain unchanged. No
  rendering/texture, physics, cooldown, scale, networking or deployment changes.
- Current checkpoint: commit containing this entry (`git log -1`); baseline
  `2e71b24`. Next: synthetic regression tests, one BMS import, audit/full tests/
  build, inspect actual connector gaps, push to PR #3.
- Limitation: each connected below-plane region is enclosed by an axis-aligned
  box. Curved posts retain conservative corners; a connected nonconvex region
  can still enclose internal empty space. Original .2 mm height / .35 mm
  footprint thresholds remain in force. Boundary-only faces are excluded.
- Extraction checkpoint: `71a589b`. Synthetic tests verify separate posts in
  shared/independent meshes, traversable gaps at .90 mm, solid posts and front
  connectors, welded seams, clipping sloped geometry, and boundary-only faces.
  Existing bottom extraction tests also pass. BMS regeneration is next.
- Test checkpoint: `d0aae51`; targeted extraction/transition/real-multiplayer
  check: 28 tests passing. SHA-256 snapshot assertions now guard the complete
  front collision array and all original bottom-mounted component boxes.
  One BMS regeneration is running; final map counts/audit/build/full suite
  and actual gap-route verification remain pending.
- Regeneration complete (one import): BACK 281 -> 381 boxes; FRONT remains
  exactly 244. J6: 1 -> 16, J9: 1 -> 20, C30: 1 -> 2; MH8 remains 1.
  Map audit passes with zero invalid boxes. GLB and both artwork PNG hashes
  exactly match the baseline. Fixed real-BMS routes: x=-16 traverses J6's
  old footprint from z=49 to 37.3333; x=-6.6 is blocked by a mounting post
  at z=46.9. These are now automated regression tests.
- `npx tsx tools/bench-protrusions.ts 2e71b24`: sampled medians per 20,000
  movement steps 13.09 -> 15.25 ms; geometry checks per step 4.02 -> 4.00.
  10,000 hitscans 46.20 -> 80.52 ms (about .008 ms/shot after). Offline
  decomposition introduces no triangle work in gameplay; counts remain modest.
- Follow-up complete: `npm test` passes all 62 tests; production build and
  regenerated BMS audit pass. `npm run test:backside` passes FRONT/BACK round
  trips on all four edges using two browser clients and authoritative snapshots.
  West BACK landing is now at y=0 in actual empty space; FRONT connector
  landing remains y=8.83. Local dev-scale server restarted and verified healthy,
  protocol 4, 381 back boxes. No known blockers; remaining approximation is
  the connected-region AABB behavior documented above.
- Follow-up files: `tools/board-surfaces.ts`, `tools/import-step.ts`,
  `tools/bench-protrusions.ts`, `tests/protrusion-collisions.test.ts`,
  `assets/public/maps/bms.json`, and this document. No other files changed.
- Commits: extraction `71a589b`, synthetic tests `d0aae51`, collision snapshots
  `71e7221`, final regenerated-map checkpoint is the commit containing this
  entry. Push these commits and update existing PR #3; do not merge.

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
- Rendering milestone: client reconciles side, cooldown and heading; rotates the
  existing world around X with the measured substrate thickness, keeps camera
  roll zero, filters remote avatars/pickups/tracers and displays FRONT/BACK HUD.
  TypeScript passes. No additional model copies or per-frame geometry rebuilds.
- BMS regeneration and audit complete: 244 FRONT boxes, 281 BACK boxes,
  substrate thickness 1.8214848 mm, back enabled. All 260 BottomLayer CSV
  components match the back geometry; 21 TopLayer through-hole parts also
  extend below the board. Both header rows and 11 front connectors preserved.

## Changed files

`shared/game.ts`; `server/{room,state}.ts`; `client/{main.ts,index.html}`;
`tools/{board-surfaces,import-step,audit-map,backside-browser}.ts`;
`tests/{board-surfaces,side-transitions,side-multiplayer}.test.ts`;
`tests/fixtures/{side-server,bms-side-server}.ts`; `assets/public/maps/bms.json`;
`package.json`; `README.md`; this document.

## Remaining / exact next steps

All implementation milestones, final verification and branch publication are
complete. PR: https://github.com/prathamingale49/fpsgame/pull/3 (against main).
No required implementation steps remain. Await user feedback and PR review;
do not merge without user approval.

## Validation and decisions

- `npm test`: 62 passing after the protrusion follow-up, including existing gameplay and multiplayer tests.
- Final physics/multiplayer focused repeat: 19 passing.
- `npm run build` and `npm run audit:map -- bms`: pass. Existing bundle-size
  advisory remains; no invalid back boxes or blocked front spawns.
- `npm run test:browser`: passes with two clients, reconnection, pointer lock,
  movement/stopping, and zero sampled correction.
- `npm run test:backside`: real BMS front/back round trips passed at all four
  edges, including obstructed west-edge landings. Final stricter repeat also
  passes, waiting for all commanded input ticks to be sent and acknowledged.
- Screenshots: ignored local `artifacts/bms-{front,back}-{north,south,east,west}.png`.
  BACK visually inspected: upright components, weapon, HUD and YJSP branding.
- BACK world transform: X rotation pi, Y translation negative substrate thickness.
  Camera remains upright in surface-local coordinates. Heading offset snaps to
  0/pi at X edges to prevent cumulative float32 drift; Z edges keep heading.
  Input yaw remains unchanged for deterministic replay.
- Local development server verified healthy: protocol 4, BMS, two-sided enabled,
  381 back boxes after the follow-up, dev scale enabled. No stale protocol/map is being served.
- Cooldown, heading and side are replayed from authoritative snapshots. Health,
  ammunition, scores and match state persist; respawns start on FRONT.

Run `npm install`, then `npm run dev` (or `npm run dev:scale` for F4).
Open http://localhost:5173. Production: `npm run build` then `npm start`.

## Known limitations

No known gameplay blockers. Backside uses STEP geometry/colors without a
separate bottom artwork texture. Complexity detection is a documented heuristic.
Browser validation uses Chrome software WebGL, so measured FPS does not
represent GPU performance. Test fixtures control edge starts and are never
exposed by the production server.
