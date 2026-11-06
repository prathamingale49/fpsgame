# Rocket jetpack flight

Implemented on `feature/rocket-jetpack-flight` for local movement testing. Main is not changed, and no pull request is created.

## Controls and initial tuning

Hold Space to engage the engine, release to coast under gravity, and steer with WASD using camera yaw. Shift increases speed only on the ground. A single-tick tap retains the previous jump impulse and arc. After exhausting fuel, release Space to rearm the engine; fuel can recharge on landing even if Space remains held, but it cannot automatically restart the engine in tiny recharge/boost cycles.

All parameters are centralized in `JETPACK` in `shared/game.ts`:

| Parameter | Value at the default 0.90 mm player scale |
| --- | --- |
| Continuous fuel | 2.5 seconds |
| Empty-to-full grounded recharge | 3 seconds |
| Gravity | 30 mm/s² (unchanged) |
| Engine acceleration | 54 mm/s² (1.8 × gravity; net +24 mm/s²) |
| Maximum ascent | 15 mm/s (1.5 × ground sprint speed) |
| Terminal descent | 22.5 mm/s (2.25 × ground sprint speed) |
| Horizontal flight speed | 7 mm/s, normalized diagonal input |
| Input safety lease | 250 ms before missing inputs become neutral physics |

The first takeoff tick uses the existing jump impulse rather than adding engine acceleration twice. Airborne engine activation/release adds/removes acceleration without resetting momentum. Speed limits scale with the existing player tuning. A full vertical launch reaches roughly 35 mm before fuel runs out at the default scale, enough to reach tall board components.

## State, collision, and transitions

`fuel`, `boosting`, and `boostLocked` are server-owned player state. They are predicted using the same fixed-step function, reconciled from snapshots, reset on respawn/round start, and ignored if supplied as client input fields. Protocol 9 prevents older movement clients from joining.

Fuel drains only during active thrust and recharges only on a grounded surface, never in flight or free fall. Board flips freeze both fuel consumption and recharge. The existing flip still places the rocket on the arrival surface with zero vertical velocity, preserving its movement lock and cooldown. Space can resume thrust once the flip finishes.

The existing component boxes and triangulated PCB floors remain authoritative. Narrow collision fixes stop upward motion at component undersides and the physical substrate underside, and prevent horizontal entry into substrate thickness from a hole. No extra landing platforms or board assets were added. Component collisions still use the existing simplified boxes, so detailed CAD recesses and curved surfaces are approximations. Legacy connector mantling remains available with empty fuel.

Client idle-input suppression stays disabled while fuel is recharging. If a connected client withholds movement input for more than 250 ms, the server advances neutral gravity/landing/recharge without acknowledging fabricated inputs. This prevents indefinite midair suspension by stopping the input stream. Ordinary input queue processing, shot history, lag compensation, and weapon tuning remain shared and unchanged.

## Presentation and changed files

- `shared/game.ts`: flight constants and fixed-step thrust/fuel/collision handling.
- `server/state.ts`, `server/room.ts`: replicated state, reset/lease handling, and authoritative movement.
- `client/main.ts`: prediction state, fuel HUD, ignition/sustained thrust/landing sounds, and remote animation wiring.
- `client/rocket-flight.ts`: lightweight orange/yellow flame, 12 exhaust particles, steering tilt, and landing compression; it never moves hitboxes or the aiming camera.
- `client/style.css`, `client/index.html`: compact fuel panel and control wording.
- `tests/jetpack.test.ts`, `tests/jetpack-server.test.ts`, `tests/fixtures/flight-server.ts`: deterministic controller/geometry and real-client checks.
- `tests/game.test.ts`, `tests/practice.test.ts`: retain empty-fuel mantle tests and adjust edge-crossing time for ground-only sprint.
- `tools/flight-browser.ts`: browser verification and captures under `docs/screenshots/jetpack`.

Every exhaust instance disposes its geometries/materials on removal or map change. The local sustained sound fades and stops on thrust release, fuel exhaustion, transitions, death, pointer release, or focus loss. Audio is synthesized through the existing Web Audio system and depends on browser interaction/audio availability.

## Verification and manual testing

Controller tests cover fuel timing, release momentum, gravity and velocity limits, grounded-only recharge, exhaustion lockout, yaw/pitch separation, ground sprint, ceiling/substrate collision, flip fuel preservation, and landings on real components on both sides of all three boards. Network tests cover two simultaneous fliers, prediction parity, observer boosting state, forged fuel rejection, missing-input falling, airborne shooting/reloading, all weapon selections, and airborne sniper ADS/recharge initiation.

Browser verification exercises fuel depletion, natural landing, full recharge, shooting and weapon selection on all three PCB maps, plus a second client's visible exhaust. Screenshots were inspected. Final verification: all 157 tests pass in 21 files; TypeScript and the production build pass. Browser checks pass on all three maps with no page errors, including observer exhaust. Vite's existing client bundle-size advisory remains.

Recommended local checks:

1. In Solo Practice, hold Space for a full launch, pulse Space to control altitude, release to coast, and land on a capacitor/connector. Confirm fuel only fills after contact.
2. Use MAPS to repeat on Recovery and Flight SAM; try the back surfaces and the Flight SAM slot flips. Fuel should freeze throughout the flip animation.
3. Try all five weapons, reload, and use sniper ADS while steering in flight. Check F5 hitboxes and F6 target controls.
4. Join from a second browser to watch exhaust, tilt, and landing compression. Test moderate latency and tune the centralized constants based on feel.

This is initial arcade tuning for user playtesting, not a final feel/balance decision. The 250 ms input lease deliberately stops thrust during a long input outage; reconnection still uses the existing room/session behavior. Extended high-latency play and subjective audio/movement feel should be evaluated manually.
