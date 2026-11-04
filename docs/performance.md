# Gameplay and rendering measurements

Measured on 2026-11-03 with Chrome headless on Windows using SwiftShader (software WebGL), an 800 × 500 viewport, device scale factor 2, and the same private BMS assets on both revisions. `main` was commit `d0fb64f`; the branch is the gameplay overhaul. `tools/perf-check.ts` sampled 30 `requestAnimationFrame` intervals after the model loaded. Values are milliseconds; lower is better. Results will vary substantially on real GPUs.

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

Reproduce with `npm run build`, then `npx tsx tools/perf-check.ts` using `BENCH_MAP=test|bms` and `BENCH_PLAYERS=1|2`. Set `BENCH_TARGET` to a built baseline checkout for comparison. Set `BENCH_BASELINE` to that checkout and run `npx tsx tools/bench-motion.ts` for collision timings. The BMS measurements require the private map assets in each checkout.
