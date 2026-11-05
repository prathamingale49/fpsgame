# Recovery and Vespula Flight SAM

Solo Practice offers BMS (default), Recovery, and Vespula Flight SAM before joining. The HUD uses the selected board's title. Each room captures its own map; concurrent practice sessions cannot change one another or public rooms. Public rooms continue to use the existing BMS configuration.

| Board | Width × depth (mm) | Substrate thickness (mm) | Front / back collision boxes | GLB |
| --- | --- | --- | --- | --- |
| BMS (existing) | 127 × 101.6 | 1.821485 | 244 / 381 | unchanged |
| Recovery | 101.6 × 101.6 | 1.963725 | 307 / 417 | 11.7 MiB |
| Vespula Flight SAM | 115.062 × 107.696 | 1.564447 | 328 / 42 | 8.6 MiB |

## Conversion and coordinates

Original supplied STEP assemblies, placement CSVs, and both PNG exports are preserved under `assets/source/recovery` and `assets/source/flight-sam`. Generated browser assets live under `assets/public/maps`.

Rebuild either board from the repository root:

```sh
npm run import:practice-map -- recovery
npm run import:practice-map -- flight-sam
```

This runs the existing OCCT importer with 0.24 mm absolute linear deflection and 0.4 rad angular deflection, then `prepare-practice-map.ts`. Recovery tessellated 2,899 solids; Flight SAM tessellated 1,690. Conversion can take several minutes. Components retain their assembled STEP positions and rotations; CSV placements are retained as metadata. Components are not reconstructed from guessed package sizes.

Game units remain millimeters. Front coordinates are `(STEP X - center X, STEP Z - board top, center Y - STEP Y)`. Back coordinates are the existing rotation about game X with the measured substrate thickness. The 0.90 mm player and all movement and weapon tuning are shared across boards.

The existing importer merges solids by material into a small number of meshes. Its existing oversized-envelope policy retains four Flight SAM solids as faint transparent geometry; no Recovery solids were classified as envelopes. Header extraction and underside protrusion processing use the same rules as BMS.

The preparation stage extracts the actual substrate top triangles from the GLB, including mounting holes and the Flight SAM cutout. These triangles define both the floor and artwork geometry. Viewport margins are cropped from the Altium exports; layer-aware map-specific solder-mask recoloring is applied to both sides: blue for Flight SAM and black for Recovery, with yellow markings. CAD substrate edges use the same board color. Bright blue bottom-layer pads are mapped to copper and dim yellow silkscreen is brightened, preserving contrast on both bottom masks. Bottom UVs reverse physical X to match the supplied bottom view. The rectangular prototype substrate and border are omitted for maps with a CAD surface.

## Collision and spawns

Visual geometry is independent of simplified component AABBs. Back components and through-board protrusions use the existing bottom collision rules. Shared movement checks the triangulated floor; holes and cutouts have no floor. The existing outer-edge flip, cooldown, heading correction, and landing-on-component logic remain shared. The three long interior edges of the Flight SAM slot use the same flip, cooldown protection, heading correction, and component-aware landing behavior. Camera orbits pivot around the actual slot edge. Small drilled mounting holes are excluded from slot flips. Interior edge segments and outward normals are extracted from the STEP floor triangulation.

Eight front spawns are selected from the largest connected region of a 2 mm grid. Candidates require floor at the center and four neighboring samples, a 4 mm outer inset, and 1 mm clearance from component boxes. Farthest-point selection distributes them across each board; the first spawn is near the center. Five NPCs use separate registered spawn positions. NPC lookahead checks the actual floor and turns away from holes and cutouts.

`shared/maps.ts` registers the practice menu entries. Additional boards use the same asset schema (`MapData`), importer, renderer, room simulation, and weapon systems.

## Verification

- Production build passes (TypeScript, Vite, server bundle); Vite reports the existing large client bundle advisory.
- Latest full run: 121 tests passed; the isolation test initially connected before its fixture was ready. Replaced its fixed startup delay with an explicit readiness signal and reran it successfully. All 122 tests are verified across the full run and that targeted rerun. Slot/transition/orbit tests pass 33/33.
- Practice browser check passes for all three maps: model loading, matching client/server map IDs, all five weapon slots, F5 hitboxes, F6 freeze/resume, returning to the menu, switching boards, and then creating a BMS public room. No browser page errors.
- Recovery and Flight SAM each pass all four outer-edge round trips with actual CAD geometry, correct side labels and camera/world orientation, synchronized side changes on a second client, and no browser page errors. Recovery's south return lands on an 8.83 mm component.
- Updated front/back browser renders were inspected and saved under `docs/screenshots/practice-maps`, including a Flight SAM slot flip. Both bottom masks show distinct copper pads and yellow markings. All three slot edges pass front/back round trips with no browser errors.

The first Flight SAM traversal run with SwiftShader completed its north round trip but could not collect the test's minimum eight animation samples; all four edges passed when rerun using hardware rendering. Automated checks do not replace extended human playtesting of every component, weapon angle, or possible route. Flight SAM slot flips are additionally covered on all three edges from both surfaces, including cooldown protection.
