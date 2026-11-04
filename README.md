# PCB FPS

Browser first-person deathmatch on a real YJSP Battery Management System (BMS) PCB. The frontend uses Three.js and Vite; a Colyseus/Node.js server owns player movement, collisions, weapons, and multiplayer game state.

**You can start playing without supplying any PCB files.** The game automatically uses the included prototype map until you import the BMS STEP assembly. You do not have to upload STEP, CSV, or PNG files to GitHub to play locally.

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
git switch feat/dev-player-scale
```

The `feat/dev-player-scale` branch contains the F4 slider from [PR #2](https://github.com/prathamingale49/fpsgame/pull/2). It is based on the gameplay-overhaul work from [PR #1](https://github.com/prathamingale49/fpsgame/pull/1). Until those PRs are merged, **the default `main` branch does not contain all of these features**.

If you **already cloned** the game, open a terminal in its `fpsgame` directory and run:

```sh
git fetch origin
git switch feat/dev-player-scale
git pull --ff-only
```

Do not discard local changes to switch branches. Files generated under `assets/public/maps/` are ignored by Git and normally remain in place when switching branches.

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

**No BMS files imported yet?** This is expected: the game shows the prototype circuit. Continue to step 5 to use the actual board.

### Development player-scale slider

After starting with `npm run dev:scale` and joining a room, press **F4** to open the slider. Pointer lock releases so you can adjust the height between **0.75 and 2.25 mm** in 0.05 mm steps. Release the slider to apply the change, then click **Close & Resume**. On some laptops you may need **Fn+F4**.

The normal game now uses a **0.90 mm** player height, chosen after testing on the BMS. The panel shows player height, jump apex, sprint speed, and hitbox width in millimeters. Jump height stays approximately **1.63× player height**, preserving the original jump proportions. Collision radius, eye height, movement speed, avatar, and weapon size scale together. F4 is still available as a development-only room-wide override; **F3** displays the active height alongside performance metrics.

The scale is a server-authoritative **room-wide development setting**, not a selectable advantage for individual players. All clients are updated together so player collision and shooting agree. The normal `npm run dev` and production server leave the slider disabled. The flag can also be set explicitly on a non-production server with `PCB_DEV_SCALE=1`; never enable this on a public game server.

Controls: WASD move, mouse aim, left click fire, Space jump or hold Space while moving into a connector ledge to climb, Shift sprint, R reload, Tab scoreboard, F3 performance overlay, Esc unlock pointer. Players can fall from PCB edges; environmental deaths count as deaths without awarding a kill. The Solder Blaster has a 30-round magazine and collects reserve ammunition from solder spools around the map. Graphics quality, mouse sensitivity, and sound volume are available under Settings. Matches last five minutes, with unlimited respawns. When the timer ends, the highest kill count wins; ties favor fewer deaths.

## 5. Import the real BMS PCB (optional)

You need the STEP assembly to generate a real PCB map. The pick-and-place CSV and top artwork PNG are recommended for a more complete import, but the importer can also run with STEP alone.

| Source file | Used for | Required? |
| --- | --- | --- |
| Assembly `.step` / `.stp` | Board and component 3D geometry | **Yes** |
| Altium pick-and-place `.csv` | Component references and positions | Recommended |
| Top artwork `.png` | Solder mask, traces, and silkscreen texture | Recommended |

You can store these anywhere on your computer. The examples below use Windows paths, but the same commands work with macOS/Linux paths.

Stop the running development server with **Ctrl+C**, then from the `fpsgame` folder run:

```sh
npm run import:step -- "C:/path/to/bms.step" "C:/path/to/pick-place.csv" "C:/path/to/bmstop.png"
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

If you already imported the BMS previously, **do not import it again**. As long as `bms.json` and `bms.glb` are still in `assets/public/maps/` (plus `bms-top.png` if the JSON references it), just start the game.

The importer builds simplified collision boxes for top-side components at least 0.8 mm wide and high, and generates safe spawn points. It preserves bottom-side geometry visually, but the underside is **not yet a playable arena**. Collision approximation can make angled components feel wider than they look.

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
The STEP importer preserves millimeter coordinates, renders top-side components, and creates simplified collision boxes, safe spawns, and climbable tall `J` connectors. The BeagleBone Black (`Q14`) model is largely translucent/non-colliding, while its narrow pin-header rows provide solid cover. Bottom-side components are visible but are not currently playable terrain. Use `npm run audit:map` after importing or changing a board.

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

**For local play, there is no need to upload any PCB files to GitHub.** By default `.gitignore` excludes `assets/public/maps/*` except `.gitkeep`, so generated BMS maps are not committed automatically. If you later deploy directly from GitHub and want the BMS online, the deployment build must receive `bms.json`, `bms.glb`, and (if referenced) `bms-top.png`—for example by intentionally committing those generated assets or providing them in the build environment. **The original STEP and pick-and-place CSV are not required at runtime.** Check large `.glb` sizes before committing to GitHub; large binaries may need a different distribution method.

To add another board, pass a fourth import argument such as `new-board`, run `npm run audit:map -- new-board`, and set `PCB_MAP_ID=new-board` for the server. The same STEP, CSV, image, GLB, and collision pipeline is used. On PowerShell, set the environment variable with `$env:PCB_MAP_ID='new-board'` before `npm start`.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `node` or `npm` not recognized | Install Node.js 22.12+, close and reopen the terminal, then run `node --version`. |
| Dependency install fails | Run `npm ci` **inside** `fpsgame` where `package-lock.json` exists. Check your network connection and Node.js version. |
| Browser cannot connect or says server version differs | Both server and frontend must be started from the **same branch**. Stop old instances, run `npm run dev:scale` again, then hard-refresh the page. |
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
