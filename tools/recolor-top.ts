import fs from 'node:fs';
import { PNG } from 'pngjs';

/** Re-map Altium's layer display colors to a readable solder-mask texture. Geometry is unchanged. */
export function recolorTop(input: string, output: string) {
  const png = PNG.sync.read(fs.readFileSync(input));
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    let color: [number, number, number];
    if (r > 110 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) color = [28, 56, 40];
    else if (r > 150 && g > 110 && b < 115) color = [226, 232, 193];
    else if (g > 90 && b > 90 && r < 145) color = [101, 150, 144];
    else if (r > 105 && g < 115 && r > g * 1.5) color = [Math.min(225, 80 + r * .52), Math.min(194, 55 + r * .4), 47 + b * .32];
    else if (b > r * 1.3 && b > g * 1.3) color = [35, 74, 56];
    else color = [34 + r * .13, 70 + r * .14 + g * .05, 33 + b * .1];
    png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2];
  }
  fs.writeFileSync(output, PNG.sync.write(png));
}
if (process.argv[1]?.endsWith('recolor-top.ts') && process.argv[2] && process.argv[3]) recolorTop(process.argv[2], process.argv[3]);
