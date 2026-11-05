# Models, pickups and weapon kill messages

Branch: feature/weapon-models-and-practice-pickups. Dependency PR #8 is open,
not merged. Based on its head 298d71e plus main 5bcfe62 (flip recharge feature).
Merge checkpoint 74d4a87; implementation checkpoint 68aa029; latest git log -1.

Completed: four cached procedural models with shared materials and independent
animation state, authoritative Iron charge pullback/compression/coil activation,
recoil/reload/bob, turbine spin/heat and pump plunger. No gameplay rays or weapon
stats changed. Pickups use miniature versions of the same factories.

Separate private Pickup Practice room: permanent Blaster and one carried special,
E validates distance/LOS/side/alive/active/version; Q swaps with preserved ammo
and cooldown, canceled reload/charge. Replacement discards the old special.
Static floor-grid locations derive from reachable sampled regions, use front
and back where available, and skip obstructed preferred positions. Separate
weapon-pickup state/timers leave solder-ammo pickups intact. Respawn defaults
to 15s (test fixture override .3s). Stale versions cannot recollect a respawn.

Kill feeds: Blaster reflowed, Iron precision-soldered, Hot Air heat-soaked,
Pump desoldered. Messages include attacker, target and weapon, from server kills.

Focused model/pickup/server tests: 14 passing. Full suite: 101 tests passed.
Production build passes. Final seven visual/placement tests pass after equip/
reload easing. Real BMS browser checks pass all four weapons, authoritative
charge, focus cancellation, E collect, Q swap, and public/sandbox isolation.
Initial room-transition reads before the first player snapshot caused two
browser errors; added guards and the repeated browser run has zero errors.
Screenshots for all four weapons, charge progression and pickups are checked
in under docs/screenshots/weapon-overhaul; see docs/weapon-visual-gallery.md.
Remaining: publish new PR targeting main; do not merge.
Known limitation: floor-grid placement is conservative and does not route
over component tops. Animation and pickup models use bounded low-poly meshes.
Sandbox remains all weapons with 1–4; Pickup Practice uses E/Q.
