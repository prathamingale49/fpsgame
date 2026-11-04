import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const scenarios: { map: string; latency: number; frameMs: number }[] = [
  { map: 'test', latency: 0, frameMs: 0 },
  { map: 'test', latency: 50, frameMs: 100 },
  { map: 'test', latency: 100, frameMs: 100 },
  { map: 'test', latency: 200, frameMs: 100 },
];
if (existsSync('assets/public/maps/bms.json') && existsSync('assets/public/maps/bms.glb')) scenarios.push(
  { map: 'bms', latency: 0, frameMs: 0 },
  { map: 'bms', latency: 100, frameMs: 100 },
  { map: 'bms', latency: 200, frameMs: 100 },
);
else console.log('Private BMS assets unavailable; BMS movement scenarios skipped.');

for (const scenario of scenarios) {
  console.log(`Movement scenario: ${JSON.stringify(scenario)}`);
  const exitCode = await new Promise<number>(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tools/movement-regression.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, MOVE_MAP: scenario.map, MOVE_LATENCY: String(scenario.latency), MOVE_FRAME_MS: String(scenario.frameMs), MOVE_SERVER_TRACE: '0' },
      stdio: 'inherit',
    });
    child.on('exit', code => resolve(code ?? 1));
  });
  if (exitCode) process.exit(exitCode);
}
