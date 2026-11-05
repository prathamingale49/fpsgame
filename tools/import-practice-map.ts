import { spawnSync } from 'node:child_process';
import { PRACTICE_MAPS } from '../shared/maps.js';

const id = process.argv[2];
if (!PRACTICE_MAPS.some(map => map.id === id) || id === 'bms') throw new Error('Supply a registered practice map ID: recovery or flight-sam');
const root = `assets/source/${id}`;
for (const args of [
  ['tools/import-step.ts', `${root}/assembly.step`, `${root}/placements.csv`, `${root}/top.png`, id],
  ['tools/prepare-practice-map.ts', id, `${root}/top.png`, `${root}/bottom.png`],
]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
