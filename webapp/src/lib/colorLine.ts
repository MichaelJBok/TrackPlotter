// Plotly scatter lines only take a single solid color per trace (unlike
// markers, which accept a per-point color array) - there's no native way to
// draw one line whose color varies continuously along its length. To get a
// gradient-colored line (matching the colored scatter dots), we split it
// into short multi-point chunks, each its own trace colored by the mean
// value of its points, with endpoints shared between neighboring chunks so
// there's no visible gap.

// Parula (MATLAB's default colormap, and what the MATLAB TrackPlotter app
// uses) - chosen over Viridis because Viridis spends a wide, nearly flat
// green/teal band through its middle range that reads as "all the same
// color" at a glance, only becoming visually distinct again near its dark
// purple and yellow ends. Parula's hue keeps shifting (blue -> teal -> green
// -> yellow) across the whole range, so the middle stays as distinguishable
// as the extremes. Stops sampled from the standard 64-entry Parula table.
const PARULA_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [53, 42, 135]],
  [0.1111, [15, 92, 221]],
  [0.2222, [18, 125, 216]],
  [0.3333, [7, 156, 207]],
  [0.4444, [21, 177, 180]],
  [0.5556, [89, 189, 140]],
  [0.6667, [165, 190, 107]],
  [0.7778, [217, 186, 86]],
  [0.8889, [247, 216, 38]],
  [1.0, [249, 251, 14]],
];

function interpStops(stops: Array<[number, [number, number, number]]>, t: number): [number, number, number] {
  const tt = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (tt >= t0 && tt <= t1) {
      const f = (tt - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

export function parulaColor(t: number): string {
  const [r, g, b] = interpStops(PARULA_STOPS, t);
  return `rgb(${r},${g},${b})`;
}

/** Custom colorscale for Plotly's `colorscale` prop (Plotly has no built-in
 * "Parula" name, unlike "Viridis"), built from the same stops as parulaColor
 * so markers and the gradient line always agree. */
export const PARULA_COLORSCALE: Array<[number, string]> = PARULA_STOPS.map(
  ([pos, [r, g, b]]) => [pos, `rgb(${r},${g},${b})`],
);

export interface LineChunk {
  x: number[];
  y: number[];
  color: string;
}

/** Splits a (x,y) line into short same-colored chunks, breaking wherever `y`
 * is non-finite (a dropout) or jumps by more than `wrapAt` (e.g. the +-180
 * bearing wrap) so a chunk never bridges a gap it shouldn't. */
export function coloredLineChunks(
  x: number[],
  y: number[],
  colorVals: number[],
  chunkSize: number,
  wrapAt = Infinity,
): LineChunk[] {
  const lo = Math.min(...colorVals);
  const hi = Math.max(...colorVals);
  const span = hi - lo || 1;

  const chunks: LineChunk[] = [];
  let curX: number[] = [];
  let curY: number[] = [];
  let curC: number[] = [];

  const flush = () => {
    if (curX.length >= 2) {
      const meanC = curC.reduce((a, b) => a + b, 0) / curC.length;
      chunks.push({ x: curX.slice(), y: curY.slice(), color: parulaColor((meanC - lo) / span) });
    }
    curX = [];
    curY = [];
    curC = [];
  };

  for (let i = 0; i < x.length; i++) {
    const broken =
      !Number.isFinite(y[i]) ||
      (i > 0 && Number.isFinite(y[i - 1]) && Math.abs(y[i] - y[i - 1]) > wrapAt);
    if (broken) {
      flush();
      if (!Number.isFinite(y[i])) continue;
    }
    curX.push(x[i]);
    curY.push(y[i]);
    curC.push(colorVals[i]);
    if (curX.length >= chunkSize) {
      flush();
      // repeat the last point so the next chunk starts where this one ended
      curX.push(x[i]);
      curY.push(y[i]);
      curC.push(colorVals[i]);
    }
  }
  flush();
  return chunks;
}
