import { parulaColor } from "./colorLine";

export interface TrackVideoOptions {
  /** Raw (pre-filter) per-frame positions; NaN = dropout. */
  x: number[];
  y: number[];
  roi: { cx: number; cy: number; diam: number } | null;
  /** Source sample rate of x/y. */
  fps: number;
  /** Output video length in seconds; 0 = native (x.length / fps). */
  durationSec: number;
  /** Draw the accumulated path behind the moving cursor, colored by time. */
  showTrail: boolean;
  onProgress?: (fraction: number) => void;
}

const OUTPUT_FPS = 30;
const MAX_DIM = 640;

/** Renders an animated top-down replay of one track's position over time -
 * a white canvas with the ROI circle, a time-colored trail, and a highlighted
 * current-position marker - and records it to a WebM video via the canvas's
 * MediaStream + MediaRecorder (no server, no video file needed). Mirrors the
 * "white canvas, no source frames" mode of the MATLAB app's video exporter;
 * it doesn't attempt the MATLAB app's full feature set (per-track styling,
 * overlaying onto the original source video, heatmap trails, etc). */
export async function recordTrackVideo(opts: TrackVideoOptions): Promise<Blob> {
  const { x, y, roi, fps, durationSec, showTrail, onProgress } = opts;
  const n = x.length;
  if (n < 2) throw new Error("Not enough points to render a video");

  let xMin: number;
  let xMax: number;
  let yMin: number;
  let yMax: number;
  if (roi && roi.diam > 0) {
    const r = (roi.diam / 2) * 1.15;
    xMin = roi.cx - r;
    xMax = roi.cx + r;
    yMin = roi.cy - r;
    yMax = roi.cy + r;
  } else {
    const finiteX = x.filter(Number.isFinite);
    const finiteY = y.filter(Number.isFinite);
    xMin = Math.min(...finiteX);
    xMax = Math.max(...finiteX);
    yMin = Math.min(...finiteY);
    yMax = Math.max(...finiteY);
    const padX = (xMax - xMin) * 0.08 || 10;
    const padY = (yMax - yMin) * 0.08 || 10;
    xMin -= padX;
    xMax += padX;
    yMin -= padY;
    yMax += padY;
  }
  const dataW = xMax - xMin || 1;
  const dataH = yMax - yMin || 1;
  const W = dataW >= dataH ? MAX_DIM : Math.round(MAX_DIM * (dataW / dataH));
  const H = dataW >= dataH ? Math.round(MAX_DIM * (dataH / dataW)) : MAX_DIM;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Data Y already increases downward (video/image convention), same as
  // canvas - no axis flip needed here, unlike the Plotly panels.
  const toPx = (dx: number, dy: number): [number, number] => [
    ((dx - xMin) / dataW) * W,
    ((dy - yMin) / dataH) * H,
  ];

  const totalDuration = durationSec > 0 ? durationSec : n / fps;
  const totalOutFrames = Math.max(1, Math.round(totalDuration * OUTPUT_FPS));

  function drawFrame(dataIdx: number) {
    ctx!.fillStyle = "white";
    ctx!.fillRect(0, 0, W, H);

    if (roi && roi.diam > 0) {
      const [cx, cy] = toPx(roi.cx, roi.cy);
      const rr = ((roi.diam / 2) / dataW) * W;
      ctx!.strokeStyle = "#ccc";
      ctx!.lineWidth = 1.5;
      ctx!.beginPath();
      ctx!.arc(cx, cy, rr, 0, 2 * Math.PI);
      ctx!.stroke();
    }

    if (showTrail) {
      for (let i = 1; i <= dataIdx; i++) {
        if (!Number.isFinite(x[i]) || !Number.isFinite(x[i - 1])) continue;
        const [x0, y0] = toPx(x[i - 1], y[i - 1]);
        const [x1, y1] = toPx(x[i], y[i]);
        ctx!.strokeStyle = parulaColor(i / (n - 1 || 1));
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.moveTo(x0, y0);
        ctx!.lineTo(x1, y1);
        ctx!.stroke();
      }
    }

    if (Number.isFinite(x[dataIdx])) {
      const [cx, cy] = toPx(x[dataIdx], y[dataIdx]);
      ctx!.fillStyle = "#e02424";
      ctx!.beginPath();
      ctx!.arc(cx, cy, 6, 0, 2 * Math.PI);
      ctx!.fill();
      ctx!.strokeStyle = "white";
      ctx!.lineWidth = 1.5;
      ctx!.stroke();
    }
  }

  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(
    OUTPUT_FPS,
  );
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    recorder.onerror = (e) => reject(e);
  });

  recorder.start();
  for (let f = 0; f < totalOutFrames; f++) {
    const dataIdx = Math.min(n - 1, Math.round((f / (totalOutFrames - 1 || 1)) * (n - 1)));
    drawFrame(dataIdx);
    onProgress?.((f + 1) / totalOutFrames);
    // Yield to the recorder between frames so it actually captures each one.
    await new Promise((r) => setTimeout(r, 1000 / OUTPUT_FPS));
  }
  recorder.stop();
  return done;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
