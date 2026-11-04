# PCB FPS

Browser first-person deathmatch on a YJSP Battery Management System circuit board. The authoritative server uses Colyseus 0.18, the client uses Three.js, and the same movement and collision rules run on both sides.

## Local play

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Use **Create Room** and share the room link, or use **Play Now** to join an open room. Each room holds up to eight players. A match begins when two join. For internet play, run the server on a publicly reachable host and share its HTTPS URL; the WebSocket endpoint uses the same host and port in production.

Controls: WASD move, mouse aim, left click fire, Space jump, Shift sprint, R reload, Tab scoreboard, Esc unlock pointer. Matches last five minutes, with unlimited respawns. When the timer ends, the highest kill count wins; ties favor fewer deaths.

## Import the BMS assembly

The private, generated BMS assets are intentionally excluded from Git. Place the STEP, pick-and-place CSV, and top artwork in a secure local folder and run:

```sh
npm run import:step -- "C:/path/assembly.step" "C:/path/pick-place.csv" "C:/path/top.png"
npm run build
npm start
```

The importer uses Open Cascade via `occt-import-js` to tessellate STEP solids, preserves their real millimeter coordinates, rotates STEP Z-up to Three.js Y-up, centers the board, combines solids by material into a GLB, and writes `assets/public/maps/bms.json`. The map contains simplified collision boxes for top-side components at least 0.8 mm across and 0.8 mm high, distributed safe spawn points, and component designators matched to Altium CSV placements. The model and map are used automatically on the next server start. Other board designs can use the same pipeline and JSON/GLB contract. The first import can take several minutes and needs ample RAM.

`bmstop.png` is mapped onto the board surface at its real aspect ratio. The board model retains STEP component placement and approximate material categories. Bottom-side components are rendered but excluded from top-side collisions. This is a game collision approximation; inspect generated boxes and spawns when changing board designs.

## Verification

```sh
npm run build
npm test
npm run test:browser
```

`npm test` checks fixed-step movement, jumps, boundaries, component shot blocking, and two real Colyseus SDK clients joining, moving, shooting, taking damage, dying, respawning, and disconnecting. `test:browser` uses two independent Chrome contexts to verify room joining, WebGL rendering, shared scoreboard, and pointer lock. It requires Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` and writes screenshots to `artifacts/`.

## Hosting

The Dockerfile builds the client and server into one service on port 2567. Use a host that supports persistent WebSockets and TLS at its edge. Set the host's public route to port 2567. Keep one server instance unless you configure shared Colyseus presence and matchmaking. Do not publish the generated `assets/public/maps/` files or deploy this proprietary board without the owner's approval.

```sh
docker build -t pcb-fps .
docker run --rm -p 2567:2567 pcb-fps
```

The code repository can be shared without the proprietary board assets. A fresh checkout then uses the prototype circuit until the private assembly is imported. `GET /api/health` reports the active map.

## Architecture and limitations

- `client/`: Vite UI and Three.js renderer, immediate local movement, reconciliation from Colyseus state, and smoothed remote avatars.
- `server/`: authoritative room simulation, rate-limited hitscan, damage, match clock, reconnect window, and spawn control.
- `shared/`: fixed-step movement, collision, weapon rules, and map contract.
- `tools/`: reusable STEP/CSV/artwork import and browser check.
- `tests/`: movement, combat, and multiplayer integration checks.

The collision map uses axis-aligned boxes; oblique parts may feel wider than they appear. The current hit validation uses the server's live player positions, so high latency can disadvantage moving targets. Future improvements: lag-compensated hit rewind, custom player animation/audio, better map texture color grading, collision inspection in a level editor, and a room directory for discovery.
