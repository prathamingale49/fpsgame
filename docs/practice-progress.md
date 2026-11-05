# YJSPS Solo Practice

Branch: `feature/solo-practice-mode`, based on main `72b39e2` (PR #4).
PR #5 remains separate; no PR #5 changes were incorporated.

Implemented private `practice` room type, one human / five NPC player states,
immediate unlimited play, shared authoritative hitscan/health/history/respawn,
three-second NPC respawn, one stationary / two walking / two dynamic targets.
Server movement uses existing fixed-step physics, random 1–3 second direction
changes, pauses, dynamic sprint/jump and inward steering near edges. Spawn
candidates check component clearance, separation and a clear walking segment.
No geometry, movement tuning, weapons or multiplayer hit-registration changes.

F5 toggles cyan wireframes using COMBAT shooting dimensions; F6 freezes/resumes
NPCs server-side; hits show floating damage numbers. Existing rocket models and
health bars are reused. YJSPS product branding uses white YJS / gold PS.

Commits: `c725434` server foundation; `d9df60c` UI/debug/branding. Latest
checkpoint is the commit containing this document (`git log -1`).

Focused integration test passes: immediate solo play, five NPCs, stationary and
moving targets, obstacle/edge checks, freeze/resume, damage/kill/3s respawn,
no NPC shots, private capacity and unchanged public waiting behavior.
Full suite: 68 tests passed. Production build passed. Real BMS Chrome browser
check passed practice entry, F5 wireframes, F6 freeze/resume, YJSPS branding,
and leaving practice to enter normal multiplayer; zero browser errors.
Screenshot `artifacts/solo-practice.png` visually inspected (cyan hitboxes,
rocket targets, health bars, white/gold YJSPS). Remaining: push/open PR to main.
Final focused repeat and TypeScript pass. The seeded fixture verifies actual
resumed motion and selects a visible target so legitimate NPC occlusion does
not make the combat check flaky. Production code matches the full-suite/build
and browser-verified revision. No required implementation work remains.
Known limits: simple steering can stop against components; no pathfinding.

Run npm run dev and click SOLO PRACTICE at http://localhost:5173.
Browser check after build: npx tsx tools/practice-browser.ts.
