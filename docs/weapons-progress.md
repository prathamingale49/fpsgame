# Practice weapons

Branch `feature/multi-weapon-solo-practice`, based on latest main `1543697`.
Core checkpoint `f1cf099`; latest checkpoint is `git log -1`.

Implemented shared IDs/config and geometry helpers, authoritative charge/heat/
cadence/ammo/reload/selection, per-weapon ammo preservation, one special slot ID,
lag-compensated iron/pump shots, current-time cone LOS and side filtering.
Default/public solder behavior is retained. Specials are selectable only in
practice. No pickups, map, tuning, rocket redesign or deployment changes.

Practice UI: 1–4 select, hold/release iron, charged cue/meter, heat meter and
overheat label, bounded single cone mesh, violet iron tracer / orange pellet
burst, distinct recoil, placeholder view-model proportions retaining scale.
Trigger aim/leases update independently of rendering; reload, switch, death,
blur, visibility loss and pointer unlock cancel charge. Server rejects stale
leases, direct instant charged shots and public special selection.

Focused tests: nine geometry/config tests and six real-server weapon tests pass.
Full suite: 92 tests passed. Production build passed. Final cadence refinement
publishes the selected weapon's remaining cooldown so the client does not
predict a shot the server would reject; the six server tests passed again.
Final production build and real BMS Chrome weapon checks also pass: iron full
charge/focus-loss cancel, Pump ammo, hot-air overheat/cooling, Blaster automatic
fire, and public solder-only selection. Screenshots under ignored artifacts/
were visually inspected. Local dev server verified with practice Pump selection
and six-round magazine. Remaining: publish branch/open PR; do not merge.

Approximation: hot air samples the target's eye-height center with its hit-radius
angular allowance and center LOS. Fine partial exposure around obstacles is
conservative. Visuals are placeholders; special reserve ammo is finite and
restored on human respawn until a later pickup-system PR.

Files: shared/weapons.ts, shared/game.ts (optional hitscan range), server/room.ts,
server/state.ts, client/main.ts, tests/weapons.test.ts,
tests/weapon-server.test.ts, tests/fixtures/weapon-server.ts,
tools/weapons-browser.ts, README.md, this document.
Reproduce browser verification after build: npx tsx tools/weapons-browser.ts.
No geometry, movement, branding or Railway files changed.
