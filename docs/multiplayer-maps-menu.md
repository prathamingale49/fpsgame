# Multiplayer maps and focused menu

New public and private multiplayer rooms choose BMS, Recovery, or Vespula Flight SAM with equal probability on the server. The room captures that map on creation; joining, reconnecting, respawning, and resetting a round never select another map. Clients wait for the initial room state and load `/api/map?mapId=<room map ID>`, using the same definition for rendering and prediction that the room uses for simulation. Client-supplied multiplayer map IDs are ignored. Protocol 8 rejects older clients that assume every room uses BMS.

Create Private Room now excludes the room from public matchmaking while retaining room-code and invite-link joining. PLAY NOW uses the existing public matchmaking flow directly.

All eleven weapon pickups retain their existing assignments: three Irons, three Hot Air guns, three Pumps, and two Snipers. Placement checks the actual floor on both surfaces, including clearance around the Flight SAM slot, component clearance, and spacing. Floor triangle queries use a cached spatial index so repeated placement and movement checks do not scan the entire substrate. Physical assets, weapon tuning, and movement equations are unchanged by this menu/multiplayer update.

Solo Practice starts on BMS. Click MAPS at the left (after releasing the pointer) or press M to open the compact sidebar. Select a board to leave that private practice room and create a fresh one for the chosen map. This resets targets, weapons, player spawn, and transient effects. Closing the sidebar keeps the session; click the game to resume. Switches dispose previous avatars, bars, pickups, hitboxes, effects, and board resources, and stale asset callbacks cannot reinsert an old map. No other room is changed.

The landing page retains YJSPS gold/charcoal branding, with PLAY NOW as the primary action, smaller private/practice actions, expandable code joining, and optional help/settings. There is no landing-page map selector.

## Verification

- `npm test`: 127 tests pass in 18 files, covering movement, combat, server, maps, and weapons.
- `npm run build`: TypeScript, Vite frontend, and server bundle. Vite's large client bundle advisory remains.
- `npx tsx tools/practice-browser.ts`: three passes across all three boards, matching server/client IDs, NPC counts, keys 1–5, shooting after every switch, F5/F6, resource counts after revisiting a map, and returning to multiplayer.
- `npx tsx tools/menu-browser.ts`: layouts at 1920×1080, 1366×768, 800×600, 375×667, and 640×480; visible PLAY NOW without scrolling, public matchmaking, private code joining with matching maps, and sidebar open/close.
- `tests/random-maps.test.ts`: equal thirds of the random selection interval; eleven supported and separated pickups across three seeds on each board.
- `tests/multiplayer-maps.test.ts`: concurrent rooms covering all three maps, fixed map identity, code joining, automatic reconnect, round reset, private matchmaking exclusion, and practice isolation.

Screenshots are in `docs/screenshots/menu`. Browser verification uses desktop Chrome with keyboard and mouse; narrow-window checks verify layout rather than touchscreen gameplay.
