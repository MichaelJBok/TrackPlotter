// One-off generator for synthetic tracks.csv fixtures matching the real
// AnimalTracker export format: Frame,TrackN_X,TrackN_Y,...,ROI_cx,ROI_cy,ROI_diam
// Track_X/Y use video pixel convention (row 0 = top, Y increases downward).
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(import.meta.dirname, "..", "src", "fixtures");

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genTrack(rng, nFrames, roiCx, roiCy, roiR, nanGapAt) {
  let x = roiCx + (rng() - 0.5) * roiR;
  let y = roiCy + (rng() - 0.5) * roiR;
  let heading = rng() * 2 * Math.PI;
  const speedBase = 3 + rng() * 6;
  const xs = [];
  const ys = [];
  for (let f = 0; f < nFrames; f++) {
    if (nanGapAt && f >= nanGapAt[0] && f < nanGapAt[1]) {
      xs.push(NaN);
      ys.push(NaN);
      continue;
    }
    // gentle random walk in heading, occasional bursts of speed
    heading += (rng() - 0.5) * 0.5;
    const speed = speedBase * (0.4 + rng() * 1.4) * (rng() < 0.05 ? 3 : 1);
    let nx = x + Math.cos(heading) * speed;
    let ny = y + Math.sin(heading) * speed;
    // soft boundary: turn back toward center if leaving the ROI
    const d = Math.hypot(nx - roiCx, ny - roiCy);
    if (d > roiR * 0.95) {
      heading = Math.atan2(roiCy - ny, roiCx - nx) + (rng() - 0.5) * 0.6;
      nx = x + Math.cos(heading) * speed;
      ny = y + Math.sin(heading) * speed;
    }
    x = nx;
    y = ny;
    xs.push(Math.round(x * 10) / 10);
    ys.push(Math.round(y * 10) / 10);
  }
  return { xs, ys };
}

function writeCsv(filename, nFrames, nTracks, roi, opts = {}) {
  const rng = mulberry32(opts.seed ?? 1);
  const tracks = [];
  // emulate real data's gap-numbering (e.g. Track1,2,4 - a lost/re-acquired
  // track under a new id) for the multi-individual fixture
  const ids = opts.trackIds ?? Array.from({ length: nTracks }, (_, i) => i + 1);
  for (let i = 0; i < nTracks; i++) {
    const nanGapAt = opts.withGap && i === 1 ? [120, 160] : undefined;
    tracks.push(genTrack(rng, nFrames, roi.cx, roi.cy, roi.r, nanGapAt));
  }

  const header = ["Frame"];
  for (const id of ids) header.push(`Track${id}_X`, `Track${id}_Y`);
  header.push("ROI_cx", "ROI_cy", "ROI_diam");

  const lines = [header.join(",")];
  for (let f = 0; f < nFrames; f++) {
    const row = [f + 1];
    for (let i = 0; i < nTracks; i++) {
      row.push(tracks[i].xs[f], tracks[i].ys[f]);
    }
    row.push(roi.cx, roi.cy, roi.r * 2);
    lines.push(row.map((v) => (Number.isNaN(v) ? "NaN" : v)).join(","));
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, filename), lines.join("\n") + "\n");
  console.log(`wrote ${filename}: ${nFrames} frames x ${nTracks} tracks`);
}

const roi = { cx: 1800, cy: 1800, r: 1050 };

// Single-individual file (matches e.g. 260814_GX010049_i1_tracks.csv)
writeCsv("260814_GX010049_i1_tracks.csv", 480, 1, roi, { seed: 42 });

// Multi-individual file (matches e.g. 260826_GX010066_ds_tracks.csv, 9 tracks)
writeCsv("260826_GX010066_ds_tracks.csv", 420, 9, roi, {
  seed: 7,
  withGap: true,
  trackIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
});
