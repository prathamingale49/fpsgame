# PCB FPS

Browser first-person deathmatch on a real YJSP Battery Management System (BMS) PCB. The frontend uses Three.js and Vite; a Colyseus/Node.js server owns player movement, collisions, weapons, and multiplayer game state.

The repository includes the YJSP BMS source files and generated map, so a fresh clone starts with the real PCB. The prototype map remains available as a fallback when no generated map is present.

## 1. Install prerequisites

- **Node.js 22.12 or newer** (includes `npm`): https://nodejs.org/
- **Git**: https://git-scm.com/downloads (or download the repository ZIP from GitHub).
- **Chrome or another desktop browser with WebGL support**. The game uses mouse pointer lock and is intended for keyboard/mouse play.

Open PowerShell or a terminal and check the installations:

```sh
node --version
npm --version
git --version
```

If `node` or `npm` is not recognized, install Node.js and reopen your terminal. If the Node.js version is below 22.12, update it first (required by the installed Vite version).

## 2. Download the game

For a **fresh clone**, run:

```sh
git clone https://github.com/prathamingale49/fpsgame.git
cd fpsgame
```

All current gameplay features, including the rocket-shaped players, opponent health bars, and the optional F4 slider, are on **`main`**.

If you **already cloned** the game, open a terminal in its `fpsgame` directory and run:

```sh
git fetch origin
git switch main
git pull --ff-only
```

Do not discard local changes to switch branches. Generated BMS map artifacts are versioned on `main`, so pulling updates also updates the playable board.

## 3. Install dependencies

From inside `fpsgame`, run:

```sh
npm ci
```

This installs the versions specified by `package-lock.json`, including the game server, Three.js, Vite, TypeScript, STEP importer, and test tools. **You do not need to install each library separately.** An internet connection is needed for the initial dependency download.

## 4. Start the game

For normal development:

```sh
npm run dev
```

To test and adjust player size using the F4 debug slider, run this **instead**:

```sh
npm run dev:scale
```

Both commands start the frontend and server together; you do not need separate terminals. Leave the command running while playing, then press **Ctrl+C** in that terminal to stop it.

| Address | Purpose |
| --- | --- |
| http://localhost:5173 | **Open this in your browser to play** (Vite frontend) |
| http://localhost:2567/api/health | Server health and active map information (JSON) |

In the browser, enter a name and click **Create Room** or **Play Now**. You can run around and test jumping with one person; a timed deathmatch starts when two players join. Use **Join Room** and the room code to connect a second player. Each room supports up to eight players.

The checked-in BMS map loads automatically. If it is missing, the game uses the prototype circuit; step 5 explains regeneration.

### Development player-scale slider

After starting with `npm run dev:scale` and joining a room, press **F4** to open the slider. Pointer lock releases so you can adjust the height between **0.75 and 2.25 mm** in 0.05 mm steps. Release the slider to apply the change, then click **Close & Resume**. On some laptops you may need **Fn+F4**.

The normal game now uses a **0.90 mm** player height, chosen after testing on the BMS. The panel shows player height, jump apex, sprint speed, and hitbox width in millimeters. Jump height stays approximately **1.63× player height**, preserving the original jump proportions. Collision radius, eye height, movement speed, avatar, and weapon size scale together. F4 is still available as a development-only room-wide override; **F3** displays the active height alongside performance metrics.

The scale is a server-authoritative **room-wide development setting**, not a selectable advantage for individual players. All clients are updated together so player collision and shooting agree. The normal `npm run dev` and production server leave the slider disabled. The flag can also be set explicitly on a non-production server with `PCB_DEV_SCALE=1`; never enable this on a public game server.

Controls: WASD move, mouse aim, left click fire, Space jump or hold Space while moving into a connector ledge to climb, Shift sprint, R reload, Tab scoreboard, F3 performance overlay, Esc unlock pointer. Opponents appear as small rocket-shaped characters with overhead health bars that drain from green toward red as they take damage. On two-sided boards such as the BMS, crossing any edge carries your view in a 0.9-second arc around that edge onto the opposite surface. Gravity turns smoothly with the arc and settles on landing; mouse look remains available, while movement and shooting wait until the transition completes. The FRONT/BACK HUD shows your current surface. The camera stays upright after landing and faces into the board. Health, ammunition, scores and the shared match timer persist. Players and solder pickups interact only on their own surface; you must wrap to the same side to fight. Single-sided boards retain falling deaths without awarding a kill. The Solder Blaster has a 30-round magazine and collects reserve ammunition from solder spools around the map. Graphics quality, mouse sensitivity, and sound volume are available under Settings. Matches last five minutes, with unlimited respawns. When the timer ends, the highest kill count wins; ties favor fewer deaths.

The importer enables two-sided gameplay when the physical bottom has at least 12 collidable parts with summed footprints covering at least 1% of board area. Legacy maps without `back` remain single-sided. Bottom coordinates use a proper 180° X rotation: `(STEP X-cx, substrate bottom-STEP Z, STEP Y-cy)`. Front coordinates use `(STEP X-cx, STEP Z-substrate top, cy-STEP Y)`. The same GLB is rotated by X=π and translated down by the measured substrate thickness for BACK rendering. Reimport older maps to extract bottom geometry; no additional artwork is required.

## 5. Regenerate the real BMS PCB (optional)

The repository already includes the generated BMS map and its STEP, pick-and-place, and artwork sources. Run the importer again after changing the geometry or collision rules. The importer can also build other maps from external files.

| Source file | Used for | Required? |
| --- | --- | --- |
| Assembly `.step` / `.stp` | Board and component 3D geometry | **Yes** |
| Altium pick-and-place `.csv` | Component references and positions | Recommended |
| Top artwork `.png` | Solder mask, traces, and silkscreen texture | Recommended |

The checked-in BMS sources are under `assets/source/`. You can also store source files elsewhere. The examples below use Windows paths, but the same commands work with macOS/Linux paths.

Stop the running development server with **Ctrl+C**, then from the `fpsgame` folder run:

```sh
npm run import:step -- "C:/path/to/bms.step" "C:/path/to/pick-place.csv" "C:/path/to/bmstop.png"
```

To regenerate from the checked-in sources on Windows:

```sh
npm run import:step -- "assets/source/latest bms.step" "assets/source/Pick Place for PCB1.csv" "assets/source/bmstop.png"
```

If you only have the STEP file:

```sh
npm run import:step -- "C:/path/to/bms.step"
```

The positional command arguments are `STEP [CSV] [PNG] [map-id]`, so include the CSV when supplying a PNG. The importer may take several minutes and use considerable RAM for a large assembly. It uses Open Cascade (`occt-import-js`) to convert STEP geometry to a Three.js-compatible model while preserving millimeter scale.

For the default BMS map, the import creates:

```text
fpsgame/
└── assets/
    └── public/
        └── maps/
            ├── bms.json                  # Map dimensions, collisions, spawns
            ├── bms.glb                   # Rendered 3D PCB assembly
            ├── bms-top.png               # Recolored PCB artwork (if supplied)
            └── bms-top-original.png      # Original artwork copy (if supplied)
```

Check the result:

```sh
npm run audit:map -- bms
```

Then **restart** with `npm run dev:scale` (or `npm run dev`) and refresh http://localhost:5173. The server automatically selects `assets/public/maps/bms.json` when it exists. Check http://localhost:2567/api/health: its `map` field should be `bms` instead of `test`.

**Important after the small-component collision update:** If you imported a BMS map with an older game version, **re-run the same `npm run import:step` command once** using your original STEP file. The collision boxes live in the generated `bms.json`; pulling new code does **not** update an existing JSON map. This regenerates the GLB and JSON and may take several minutes. Restart both the server and browser afterward. If you have already imported with the updated collision rules, you do not need to repeat the import on every run.

The importer creates simplified collision boxes for top-side components at least **0.20 mm above the board** with at least **0.35 mm footprint in both dimensions**. This includes ordinary 0402 and 0603 capacitors and resistors while filtering out very thin copper/pad details. It also generates safe spawn points. Bottom-side components remain visible but the underside is **not yet a playable arena**. Collision boxes are axis-aligned approximations, so rotated parts may feel wider than they look.

`bmstop.png` is recolored from Altium layer colors to green solder mask, copper and light silkscreen without moving pixels, then mapped onto the board at its real aspect ratio. The board model retains STEP component placement and approximate material categories.

The STEP assembly also includes a BeagleBone Black model (`Q14`) that spans roughly 90 × 55 mm over the BMS. It is rendered translucent and omitted from collisions so the actual BMS surface remains visible and navigable; its CAD position is preserved.

## 6. Build and run the production version locally

Development mode runs the Vite frontend on port 5173 and the Node.js server on 2567. To test the bundled version that would be deployed, **stop the development server**, then run:

```sh
npm run build
npm start
```

Open **http://localhost:2567** instead of 5173. The Node.js server serves both the compiled frontend and multiplayer backend on one port. If you want the BMS to appear in this version, import it **before** `npm run build`, since Vite copies the map assets into the compiled frontend during the build. `npm start` does not enable the scale slider.

## 7. Run tests (optional)
The STEP importer preserves millimeter coordinates, renders top-side components, and creates simplified collision boxes, safe spawns, and climbable tall `J` connectors. At 0.90 mm player height, some tall connectors are intentionally unreachable. The BeagleBone Black (`Q14`) model is largely translucent/non-colliding, while its narrow pin-header rows provide solid cover. Bottom-side components are visible but are not currently playable terrain. Use `npm run audit:map` after importing or changing a board.

```sh
npm run build
npm test
npm run test:browser
npm run test:movement
npm run audit:map
npm run test:soak
```

`npm run build` checks TypeScript and bundles the frontend/backend. `npm test` covers fixed-step physics, scaled jump and hitboxes, connector mantling, edge falls, shooting, ammunition, and real multiplayer sessions including environmental deaths and respawns. `test:browser` checks WebGL and room controls; `test:movement` checks prediction and reconciliation with network delay; `test:soak` runs a three-minute two-client performance session. Browser tests currently expect Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`, so scripts may need adjustment on macOS/Linux. Diagnostics go into ignored `artifacts/`; see [docs/performance.md](docs/performance.md).

The soak defaults to SwiftShader for repeatability. On Windows with a working GPU, use `$env:SOAK_RENDERER='hardware'` before `npm run test:soak` to measure the Direct3D 11 ANGLE path.

## 8. Put the game online (later)

The included Dockerfile builds the client and server into one Node.js service on port **2567**. Use a host supporting persistent WebSocket connections (such as Railway). Configure HTTPS/WSS at the public edge, point traffic to port 2567, and initially use **one server instance**. Additional instances require shared Colyseus presence and room routing.

```sh
docker build -t pcb-fps .
docker run --rm -p 2567:2567 pcb-fps
```

The YJSP source files and generated BMS map are committed to GitHub. Deployments built from this repository therefore include `bms.json`, `bms.glb`, and the top artwork automatically. The STEP and pick-and-place CSV are retained for reproducible regeneration but are not required at runtime.

To add another board, pass a fourth import argument such as `new-board`, run `npm run audit:map -- new-board`, and set `PCB_MAP_ID=new-board` for the server. The same STEP, CSV, image, GLB, and collision pipeline is used. On PowerShell, set the environment variable with `$env:PCB_MAP_ID='new-board'` before `npm start`.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `node` or `npm` not recognized | Install Node.js 22.12+, close and reopen the terminal, then run `node --version`. |
| Dependency install fails | Run `npm ci` **inside** `fpsgame` where `package-lock.json` exists. Check your network connection and Node.js version. |
| Browser cannot connect or says server version differs | Pull the latest `main`, stop old server instances, run `npm run dev` (or `npm run dev:scale` when testing sizes), then hard-refresh the page. |
| 0402/0603 components are visually present but not solid | Your imported `bms.json` probably predates the reduced collision threshold. Re-run `npm run import:step` with the original STEP file, restart the server, and verify the map is selected at `/api/health`. |
| `localhost:5173` does not open | Leave `npm run dev` or `npm run dev:scale` running and check its terminal output for an error or port conflict. |
| F4 slider does not appear | Start with `npm run dev:scale` and **join a room first**. Check `/api/health` for `"devScaleEnabled":true`. |
| BMS does not appear | Verify `assets/public/maps/bms.json` and `bms.glb` exist; restart the server and confirm `/api/health` says `"map":"bms"`. |
| PCB has no artwork | Supply the optional PNG at import time and verify `bms-top.png` exists. |
| STEP import is slow or fails | Full assemblies can need considerable memory. Verify the file is a real STEP assembly, not just a PCB outline. |
| Multiplayer lags or snaps backward | Press **F3** to view FPS, ping, input backlog and correction. Test with two clients and the same server build; reduce graphics quality under Settings if rendering is slow. |

For Windows PowerShell, all the commands above work as written, including paths with forward slashes inside quotes. For macOS/Linux, replace the example Windows file paths with actual local paths. The game files and scripts must be run from the `fpsgame` repository root.

## Architecture and limitations

- `client/`: Vite UI and Three.js renderer, immediate local movement, reconciliation from Colyseus state, and smoothed remote avatars.
- `server/`: authoritative room simulation, rate-limited hitscan, damage, match clock, reconnect window, and spawn control.
- `shared/`: fixed-step movement, spatial collision grid, player and weapon tuning, and map contract.
- `tools/`: reusable STEP/CSV/artwork import and browser check.
- `tests/`: movement, combat, and multiplayer integration checks.

The collision map uses axis-aligned boxes; oblique parts may feel wider than they appear. The current hit validation uses the server's live player positions, so high latency can disadvantage moving targets. Future improvements: lag-compensated hit rewind, custom player animation/audio, better map texture color grading, collision inspection in a level editor, and a room directory for discovery.
