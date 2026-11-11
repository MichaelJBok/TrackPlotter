// Plotly scatter lines only take a single solid color per trace (unlike
// markers, which accept a per-point color array) - there's no native way to
// draw one line whose color varies continuously along its length. To get a
// gradient-colored line (matching the colored scatter dots), we split it
// into short multi-point chunks, each its own trace colored by the mean
// value of its points, with endpoints shared between neighboring chunks so
// there's no visible gap.
const VIRIDIS_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [68, 1, 84]],
  [0.13, [71, 44, 122]],
  [0.25, [59, 81, 139]],
  [0.38, [44, 113, 142]],
  [0.5, [33, 144, 141]],
  [0.63, [39, 173, 129]],
  [0.75, [92, 200, 99]],
  [0.88, [170, 220, 50]],
  [1.0, [253, 231, 37]],
];

export function viridisColor(t: number): string {
  const tt = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  for (let i = 0; i < VIRIDIS_STOPS.length - 1; i++) {
    const [t0, c0] = VIRIDIS_STOPS[i];
    const [t1, c1] = VIRIDIS_STOPS[i + 1];
    if (tt >= t0 && tt <= t1) {
      const f = (tt - t0) / (t1 - t0);
      const r = Math.round(c0[0] + f * (c1[0] - c0[0]));
      const g = Math.round(c0[1] + f * (c1[1] - c0[1]));
      const b = Math.round(c0[2] + f * (c1[2] - c0[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = VIRIDIS_STOPS[VIRIDIS_STOPS.length - 1][1];
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

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
      chunks.push({ x: curX.slice(), y: curY.slice(), color: viridisColor((meanC - lo) / span) });
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
