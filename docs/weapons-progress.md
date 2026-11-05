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
Remaining: full tests/build, actual BMS browser weapon checks, documentation,
push branch and open a PR targeting main without merging.

Approximation: hot air samples the target's eye-height center with its hit-radius
angular allowance and center LOS. Fine partial exposure around obstacles is
conservative. Visuals are placeholders; special reserve ammo is finite and
restored on human respawn until a later pickup-system PR.
