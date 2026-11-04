# Gameplay and rendering measurements

Measured on 2026-11-03 with Chrome headless on Windows using SwiftShader (software WebGL), an 800 × 500 viewport, device scale factor 2, and the same BMS assets on both revisions. `main` was commit `d0fb64f`; the branch is the gameplay overhaul. `tools/perf-check.ts` sampled 30 `requestAnimationFrame` intervals after the model loaded. Values are milliseconds; lower is better. Results will vary substantially on real GPUs.

| Scene | Players | `main` median / p95 | Branch median / p95 | Canvas pixels |
| --- | ---: | ---: | ---: | --- |
| Prototype | 1 | 36.5 / 115.2 | 12.1 / 18.2 | 1600×1000 → 800×500 |
| BMS | 1 | 1175.3 / 1235.8 | 696.8 / 733.0 | 1600×1000 → 800×500 |
| BMS | 2 | 1914.4 / 1975.1 | 1114.7 / 1163.2 | 1600×1000 → 800×500 |

The main rendering change is the default pixel ratio cap of 1. Graphics settings allow 0.75, 1, and 1.5, limited by device scale. Texture anisotropy is capped at 4. The BMS model remains visually intact. The F3 overlay on a two-client BMS run showed 35 draw calls and 505,377 rendered triangles. The GLB contains roughly 415,000 source triangles in eight material groups, and the top texture is 1389 × 1111. The overlay's render-call CPU measurement was around 2 ms during that run, while frame intervals were far longer, so the software graphics path dominates this environment. GPU timestamp queries were unavailable in the headless test; these figures are frame intervals, not direct GPU timings.

`tools/bench-motion.ts` compared 10,000 stationary collision steps using the same map data:

| Collision scene | `main` | Branch | Nearby geometry checks per branch step |
| --- | ---: | ---: | ---: |
| Dense BMS location, 120 boxes | 11.3 ms | 13.3 ms | 7 |
| Synthetic grid, 1000 boxes | 66.2 ms | 18.1 ms | 74 |

The grid scales better as component count grows. On the current 120-box BMS, lookup overhead adds about 0.2 microseconds per step at this sampled location. This remains well below a 16.7 ms simulation tick. Geometry checks are actual instrumented checks for the branch; the old function loops over every box.

The integration suite delivers ordered movement packets with 0, 50, 100, and 200 ms delay plus jitter. Server position after acknowledgment matches the shared 60 Hz simulation for horizontal and jump movement to three decimal places. The browser test uses two independent clients on the BMS, including reconnection, movement, key release, graphics settings, and F3 telemetry. Headless SwiftShader remains too slow for normal BMS play; gameplay should also be profiled on the target GPU and browser.

## Three-minute gameplay soak

Measured on 2026-11-04 with two independent Chrome contexts on the imported BMS. Both players continuously sprinted, jumped, and changed direction for 180 seconds. The table compares the first and last 30-second windows from `npm run test:soak`. Chrome used the Intel UHD Direct3D 11 ANGLE path on this laptop; the NVIDIA GPU was not selected by headless Chrome.

| Measurement | Initial client A / B | Final client A / B |
| --- | ---: | ---: |
| FPS | 59.1 / 59.3 | 60.0 / 60.0 |
| Median frame time | 16.7 / 16.7 ms | 16.7 / 16.7 ms |
| p95 frame time | 16.8 / 16.8 ms | 16.8 / 16.8 ms |
| Pending inputs | 3 / 3 | 4 / 3 |
| Maximum pending inputs | 7 / 7 | 7 / 7 |
| In-play correction p95 | 0 / 0 mm | 0 / 0 mm |
| Collision query cache | 46 / 33 | 46 / 33 |
| Textures | 2 / 2 | 2 / 2 |
| JS heap | 23.28 / 22.44 MB | 23.08 / 22.72 MB |

Server tick work averaged 0.147 ms in the initial sample and 0.087 ms afterward. Its input queue stayed at zero throughout. Server heap grew from 22.28 to 24.84 MB while processing 21,207 inputs; the falling tick cost and empty queue show no progressive server slowdown. Renderer geometries were 75/87 initially and 79/87 finally. The four-object increase came from synchronized pickup objects becoming visible, while texture count remained fixed. Large absolute correction maxima in the raw artifact are intentional respawn relocations after environmental deaths; the in-play correction percentile excludes those transitions.

The investigation found two accumulating costs. Chrome can schedule `setInterval(1000 / 60)` close to 62.5 Hz because of 16 ms timer quantization, slowly producing inputs faster than the 60 Hz server. The client now gates samples with a monotonic 60 Hz deadline and suppresses repeated identical idle samples. Cross-cell collision query combinations also grew for every newly traversed route; that cache is now capped at 256 entries. In the final soak, each client's cache stopped growing well below the cap and the server queue stayed empty.

A repeat using forced SwiftShader confirmed stable gameplay state but unsuitable rendering measurements: p95 changed from about 650 to 666 ms while mean FPS varied from 3.4–3.7 to 2.2 due to two software-rendered BMS clients sharing CPU. Pending inputs stayed below 46, correction p95 was zero, textures stayed fixed, and query caches stopped growing. Use `$env:SOAK_RENDERER='hardware'` before `npm run test:soak` on PowerShell for representative frame measurements; omit it for the deterministic software fallback.

Reproduce with `npm run build`, then `npx tsx tools/perf-check.ts` using `BENCH_MAP=test|bms` and `BENCH_PLAYERS=1|2`. Set `BENCH_TARGET` to a built baseline checkout for comparison. Set `BENCH_BASELINE` to that checkout and run `npx tsx tools/bench-motion.ts` for collision timings. Run `npm run test:soak` for the 180-second two-client soak. The BMS assets are versioned under `assets/public/maps/`.
