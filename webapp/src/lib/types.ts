export interface TracksData {
  frame: number[];
  /** label -> per-frame X/Y in raw video pixel coords (NaN = dropout) */
  tracks: Record<string, { x: number[]; y: number[] }>;
  trackLabels: string[];
  roi: { cx: number; cy: number; diam: number } | null;
}

export interface Settings {
  fps: number;
  /** cm-per-px; 1 = stay in px. Derived, not directly settable - see
   * roiDiameterReal and App.tsx's effectiveSettings. */
  pxScale: number;
  /** The ROI's real-world diameter in cm - pxScale is computed from this ÷
   * the ROI's pixel diameter (read from the loaded CSV), instead of asking
   * you to compute a px-per-cm ratio yourself. 0 = not calibrated, stays
   * in px. */
  roiDiameterReal: number;
  minSpeed: number;
  polAngle: number; // degrees
  showPolLine: boolean;
  timeCutSec: number | null; // null = off
  roiFilterPct: number; // 0 = off
  colorMode: "time" | "speed";
  /** Locks the speed axis (Speed panel, Speed vs Direction, and Speed
   * Distribution's x-range) to a percentile computed across every track in
   * the file, instead of each track autoscaling its own axis. */
  lockSpeedAxis: boolean;
  speedPercentile: number; // 1-100, used by lockSpeedAxis
  /** Locks the count (y) axis of Speed Distribution and Direction (axial)
   * to the tallest bin across every track in the file. */
  lockHistAxis: boolean;
  /** Dark theme and a colorblind-safe palette, both scoped to the Overview
   * (XY overlay, polar, bar panels) only. */
  darkMode: boolean;
  colorBlindMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fps: 10,
  pxScale: 1,
  roiDiameterReal: 0,
  minSpeed: 0,
  polAngle: 0,
  showPolLine: false,
  timeCutSec: null,
  roiFilterPct: 0,
  colorMode: "time",
  lockSpeedAxis: false,
  speedPercentile: 95,
  lockHistAxis: false,
  darkMode: false,
  colorBlindMode: false,
};

/** The subset of Settings that makes sense to tune per-experiment (frame
 * rate, physical scale, filtering/display, and the polarization reference
 * axis all depend on the video/setup, not the viewer) - overridable per
 * experiment in App.tsx, with an "Apply to all" button to broadcast one
 * experiment's values to every other loaded one. */
export type CoreSettings = Pick<
  Settings,
  "fps" | "roiDiameterReal" | "minSpeed" | "roiFilterPct" | "colorMode" | "polAngle"
>;

/** A loaded video-frame background for the Overview XY plot, in the same
 * pixel coordinate system as the tracks (origin top-left). */
export interface BackgroundImage {
  url: string;
  width: number;
  height: number;
}

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
