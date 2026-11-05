# YJSPS Solo Practice

Branch: `feature/solo-practice-mode`, based on main `72b39e2` (PR #4).
Updated with main `19ac8de` after PR #5 merged, at the user's request. The
practice feature remains on its own PR #6 branch.

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
After main/PR #5 integration: full suite 77 tests passed. Production build passed. Real BMS Chrome browser
check passed practice entry, F5 wireframes, F6 freeze/resume, YJSPS branding,
and leaving practice to enter normal multiplayer; zero browser errors.
Screenshot `artifacts/solo-practice.png` visually inspected (cyan hitboxes,
rocket targets, health bars, white/gold YJSPS).
Published PR: https://github.com/prathamingale49/fpsgame/pull/6 (unmerged).
Implementation checkpoint: `331668f`; latest commit is `git log -1`.
Local server on port 2567 verified: practice=true, six player states, playing.
PR #5 integration preserves NPC shooting rejection together with the new
authoritative transition shooting lock. Practice floating damage numbers hide
during the orbit, matching avatars and hitboxes. Added practice-room coverage
for side changes, locked movement/shooting and shooting after the lock expires.
Final focused repeat and TypeScript pass. The seeded fixture verifies actual
resumed motion and selects a visible target so legitimate NPC occlusion does
not make the combat check flaky. Production code matches the full-suite/build
and browser-verified revision. No required implementation work remains.
Known limits: simple steering can stop against components; no pathfinding.

PR #5 integration verification: new practice regression passes movement/shooting
lock during flips and resumed shooting afterward. Practice browser flow passes.
All four real-BMS orbit round trips pass using BACKSIDE_RENDERER=hardware,
capturing 257–286 frames per edge; original orbit assertions remain intact.
Forced SwiftShader failed the minimum-frame requirement, so the browser harness
now supports selecting hardware rendering and reports sampled progress on failure.
Local dev-scale server restarted: HTTP 5173=200, protocol 5, six practice player
states, immediate playing, .9-second flip lock. Latest checkpoint: git log -1.

Run npm run dev and click SOLO PRACTICE at http://localhost:5173.
Browser check after build: npx tsx tools/practice-browser.ts.
