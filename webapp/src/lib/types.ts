export interface TracksData {
  frame: number[];
  /** label -> per-frame X/Y in raw video pixel coords (NaN = dropout) */
  tracks: Record<string, { x: number[]; y: number[] }>;
  trackLabels: string[];
  roi: { cx: number; cy: number; diam: number } | null;
}

export interface Settings {
  fps: number;
  pxScale: number; // cm per px; 1 = stay in px
  minSpeed: number;
  polAngle: number; // degrees
  timeCutSec: number | null; // null = off
  roiFilterPct: number; // 0 = off
  colorMode: "time" | "speed";
}

export const DEFAULT_SETTINGS: Settings = {
  fps: 10,
  pxScale: 1,
  minSpeed: 0,
  polAngle: 0,
  timeCutSec: null,
  roiFilterPct: 0,
  colorMode: "time",
};

export interface TrackStats {
  label: string;
  nValid: number;
  totalDist: number;
  meanSpeed: number;
  medianSpeed: number;
  straightness: number; // SI = net displacement / path length
  meanAbsTurnDeg: number;
  netDisp: number;
  meanAxialDirDeg: number; // doubled-angle circular mean, 0-180
  vectorR: number; // 0-1
}
