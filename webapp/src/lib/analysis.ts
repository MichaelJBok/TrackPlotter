import type { Settings, TracksData, TrackStats } from "./types";

const toDeg = (rad: number) => (rad * 180) / Math.PI;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Time cutoff + ROI% filter, applied the same way the MATLAB app does: NaN
 * out anything past/outside the threshold, same units as the raw track. */
export function applyFilters(
  x: number[],
  y: number[],
  roi: TracksData["roi"],
  settings: Pick<Settings, "fps" | "timeCutSec" | "roiFilterPct">,
): { x: number[]; y: number[] } {
  let xs = x.slice();
  let ys = y.slice();

  if (settings.timeCutSec != null && Number.isFinite(settings.timeCutSec)) {
    const cutIdx = Math.floor(settings.timeCutSec * settings.fps); // 0-based
    for (let i = cutIdx; i < xs.length; i++) {
      xs[i] = NaN;
      ys[i] = NaN;
    }
  }

  if (settings.roiFilterPct > 0 && roi && roi.diam > 0) {
    const radius = (roi.diam / 2) * (settings.roiFilterPct / 100);
    for (let i = 0; i < xs.length; i++) {
      const d = Math.hypot(xs[i] - roi.cx, ys[i] - roi.cy);
      if (d > radius) {
        xs[i] = NaN;
        ys[i] = NaN;
      }
    }
  }

  return { x: xs, y: ys };
}

export interface FrameSeries {
  /** 1-based frame index of each step (aligned like MATLAB's `fr = find(vp)+1`) */
  frame: number[];
  speedRaw: number[];
  speedSmooth: number[];
  dirDeg: number[]; // atan2d(dy,dx), -180..180
}

/** Per-step speed/direction from consecutive valid (non-NaN) positions. */
export function computeFrameSeries(x: number[], y: number[], fps: number, pxScale: number): FrameSeries {
  const frame: number[] = [];
  const speedRaw: number[] = [];
  const dirDeg: number[] = [];
  for (let i = 0; i < x.length - 1; i++) {
    if (Number.isNaN(x[i]) || Number.isNaN(x[i + 1])) continue;
    const dx = x[i + 1] - x[i];
    const dy = y[i + 1] - y[i];
    frame.push(i + 2); // 1-based frame number of the *later* sample
    speedRaw.push(Math.hypot(dx, dy) * pxScale * fps);
    dirDeg.push(toDeg(Math.atan2(dy, dx)));
  }
  const speedSmooth = movingAverage(speedRaw, 5);
  return { frame, speedRaw, speedSmooth, dirDeg };
}

export function movingAverage(values: number[], window: number): number[] {
  if (values.length < window) return values.slice();
  const half = Math.floor(window / 2);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/** Circular moving average: averages the sin/cos components so it doesn't
 * break at the +-180 wrap the way a plain average of degrees would (e.g.
 * naively averaging +179 and -179 gives ~0 instead of the correct ~180). */
export function circularMovingAverage(deg: number[], window: number): number[] {
  if (deg.length < window) return deg.slice();
  const sin = movingAverage(deg.map((d) => Math.sin(toRad(d))), window);
  const cos = movingAverage(deg.map((d) => Math.cos(toRad(d))), window);
  return sin.map((s, i) => toDeg(Math.atan2(s, cos[i])));
}

/** Splits a (frame, deg) line into segments broken at any remaining >180
 * jump between consecutive points, so a plotting library doesn't draw a
 * spurious vertical line across the +-180 wrap. Returns arrays with `null`
 * gaps, which Plotly treats as a line break. */
export function breakAtWrap(frame: number[], deg: number[]): { frame: number[]; deg: (number | null)[] } {
  const outFrame: number[] = [];
  const outDeg: (number | null)[] = [];
  for (let i = 0; i < deg.length; i++) {
    outFrame.push(frame[i]);
    outDeg.push(deg[i]);
    if (i < deg.length - 1 && Math.abs(deg[i + 1] - deg[i]) > 180) {
      outFrame.push(frame[i]);
      outDeg.push(null);
    }
  }
  return { frame: outFrame, deg: outDeg };
}

/** Circular mean + vector strength R via the doubled-angle trick: a bearing
 * and its 180-flip are the same axis (e.g. a polaroid/body axis), so angles
 * are doubled before averaging (making theta and theta+180 coincide), then
 * the result is halved back. R=0 -> uniformly spread; R=1 -> perfectly
 * aligned. polAngle rotates the reference axis (0 = east) before this. */
export function axialMeanR(deg: number[], polAngle: number): { meanDeg: number; R: number } {
  if (deg.length === 0) return { meanDeg: NaN, R: NaN };
  let sumSin = 0;
  let sumCos = 0;
  for (const d of deg) {
    const ax = (((d - polAngle) % 180) + 180) % 180; // axial range [0,180)
    const theta2 = toRad(ax) * 2;
    sumSin += Math.sin(theta2);
    sumCos += Math.cos(theta2);
  }
  const n = deg.length;
  const sin = sumSin / n;
  const cos = sumCos / n;
  const R = Math.hypot(sin, cos);
  let meanDeg = toDeg(Math.atan2(sin, cos) / 2);
  meanDeg = ((meanDeg % 180) + 180) % 180;
  return { meanDeg, R };
}

export interface PathStats {
  totalDist: number;
  netDisp: number;
  straightness: number; // SI
  meanAbsTurnDeg: number;
}

export function computePathStats(x: number[], y: number[], pxScale: number, dirDeg: number[]): PathStats {
  let totalDist = 0;
  for (let i = 0; i < x.length - 1; i++) {
    if (Number.isNaN(x[i]) || Number.isNaN(x[i + 1])) continue;
    totalDist += Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i]) * pxScale;
  }
  const validIdx: number[] = [];
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) validIdx.push(i);
  let netDisp = NaN;
  let straightness = NaN;
  if (validIdx.length >= 2) {
    const first = validIdx[0];
    const last = validIdx[validIdx.length - 1];
    netDisp = Math.hypot(x[last] - x[first], y[last] - y[first]) * pxScale;
    if (totalDist > 1e-9) straightness = netDisp / totalDist;
  }
  let meanAbsTurnDeg = NaN;
  if (dirDeg.length >= 2) {
    const turns: number[] = [];
    for (let i = 0; i < dirDeg.length - 1; i++) {
      let d = dirDeg[i + 1] - dirDeg[i];
      d = ((d + 180) % 360 + 360) % 360 - 180;
      turns.push(Math.abs(d));
    }
    meanAbsTurnDeg = turns.reduce((a, b) => a + b, 0) / turns.length;
  }
  return { totalDist, netDisp, straightness, meanAbsTurnDeg };
}

export function computeTrackStats(
  label: string,
  x: number[],
  y: number[],
  settings: Settings,
): TrackStats {
  const { speedRaw, dirDeg } = computeFrameSeries(x, y, settings.fps, settings.pxScale);
  const above = speedRaw.filter((s) => s >= settings.minSpeed);
  const dirAbove = dirDeg.filter((_, i) => speedRaw[i] >= settings.minSpeed);
  const path = computePathStats(x, y, settings.pxScale, dirAbove);
  const { meanDeg, R } = axialMeanR(dirAbove, settings.polAngle);
  const nValid = x.filter((v) => !Number.isNaN(v)).length;
  return {
    label,
    nValid,
    totalDist: path.totalDist,
    meanSpeed: above.length ? above.reduce((a, b) => a + b, 0) / above.length : NaN,
    medianSpeed: above.length ? median(above) : NaN,
    straightness: path.straightness,
    meanAbsTurnDeg: path.meanAbsTurnDeg,
    netDisp: path.netDisp,
    meanAxialDirDeg: meanDeg,
    vectorR: R,
  };
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear-interpolation percentile (0-100), matching MATLAB's default
 * `prctile` closely enough for axis-scaling purposes. */
export function percentile(values: number[], pct: number): number {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  if (s.length === 1) return s[0];
  const rank = (pct / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

/** Maps each value to its empirical-CDF rank in [0,1] (histogram
 * equalization). Colors a speed-colored plot should use this, not the raw
 * speed: a linear min-max scaling lets a handful of fast outliers stretch
 * the color range so almost every point (the typical/slow majority) ends up
 * crammed into one end of it. Ranking instead spreads color by how the
 * values are actually distributed, so the bulk of the data uses the bulk of
 * the colorscale. Matches the MATLAB app's speed-color mapping. Ties share
 * the average rank of the tied run. */
export function rankTransform(values: number[]): number[] {
  const n = values.length;
  const ranks = new Array(n).fill(NaN);
  const order = values.map((_, i) => i).filter((i) => Number.isFinite(values[i]));
  order.sort((a, b) => values[a] - values[b]);
  const m = order.length;
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && values[order[j + 1]] === values[order[i]]) j++;
    const avgRank = (i + j) / 2 / (m - 1 || 1);
    for (let k = i; k <= j; k++) ranks[order[k]] = avgRank;
    i = j + 1;
  }
  return ranks;
}
