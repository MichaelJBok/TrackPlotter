import Papa from "papaparse";
import type { TracksData } from "./types";

/**
 * Parses an AnimalTracker tracks.csv: Frame, {Label}_X, {Label}_Y (repeated
 * for 1-10 individuals, numbering can have gaps), optional ROI_cx/cy/diam
 * (same value every row - we just read row 1).
 */
export function parseTracksCsv(csvText: string): TracksData {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const rows = parsed.data;
  const fields = parsed.meta.fields ?? [];

  const trackLabels: string[] = [];
  for (const f of fields) {
    if (f.endsWith("_X")) {
      const label = f.slice(0, -2);
      if (fields.includes(`${label}_Y`)) trackLabels.push(label);
    }
  }

  const toNum = (v: string | undefined): number => {
    if (v === undefined || v === "" || v.trim().toUpperCase() === "NAN") return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const frame = rows.map((r) => toNum(r["Frame"]));
  const tracks: TracksData["tracks"] = {};
  for (const label of trackLabels) {
    tracks[label] = {
      x: rows.map((r) => toNum(r[`${label}_X`])),
      y: rows.map((r) => toNum(r[`${label}_Y`])),
    };
  }

  let roi: TracksData["roi"] = null;
  if (fields.includes("ROI_cx") && fields.includes("ROI_cy") && fields.includes("ROI_diam") && rows.length > 0) {
    const cx = toNum(rows[0]["ROI_cx"]);
    const cy = toNum(rows[0]["ROI_cy"]);
    const diam = toNum(rows[0]["ROI_diam"]);
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(diam) && diam > 0) {
      roi = { cx, cy, diam };
    }
  }

  return { frame, tracks, trackLabels, roi };
}
