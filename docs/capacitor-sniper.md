Precision Iron now deals `25 + 65 * clamp(serverHoldSeconds, 0, 1)` damage. It retains five rounds, its reload, perfect accuracy and charge animation.

Capacitor Sniper fires immediately for 100 damage, with one round and a renewable 2.5-second capacitor recharge. Its authoritative deadline survives switching to the Blaster and back; death clears it. Right-click ADS zooms 1.75× over 0.15 seconds without changing movement or aim direction. Scoped shots are exact; the server generates hip spread in a 0.035-radian disk. No falloff, headshot bonus or penetration.

Practice slots 1–5 include the sniper. Multiplayer requests nine existing special pickups plus two snipers, retaining collision clearance and minimum spacing; constrained maps can return fewer safe placements. Pickups retain E collection/replacement and Q swapping.

The procedural model has a capacitor, copper barrel, substrate/traces, cyan contacts and a holographic sight. Its cyan intensity and charging bar follow the server deadline. HUD shows charge percentage, ready status, 0/1 or 1/1, and an ADS reticle. Kill messages use “capacitor-discharged.”

Manual checks: join Solo Practice, press 5, right-click, shoot a target, switch 1→5 repeatedly during recharge, and verify that another shot waits for completion. Test loss of pointer lock, death, edge flips and pickup replacement. Repeat with two multiplayer clients collecting a sniper and confirm a scoped direct hit kills once. Run `npx tsx tools/sniper-browser.ts` with the local dev server for the BMS browser smoke test.

Visual limitation: electrical effects use lightweight emissive meshes rather than a detailed arc simulation. Placement retains the existing conservative connected-floor sampler.
