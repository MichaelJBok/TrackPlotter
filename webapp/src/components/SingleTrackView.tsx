import { useState } from "react";
import Plot from "react-plotly.js";
import type { TracksData, Settings } from "../lib/types";
import {
  applyFilters,
  computeFrameSeries,
  computePathStats,
  circularMovingAverage,
  axialMeanR,
} from "../lib/analysis";
import { coloredLineChunks } from "../lib/colorLine";
import { basePlotConfig, baseLayout, gridColor } from "../lib/plotDefaults";

interface Props {
  data: TracksData;
  label: string;
  settings: Settings;
}

/** Single-track analysis: 2 rows x 4 columns.
 * Row 1: [Track] [Speed & Direction (spans cols 2-4)]
 * Row 2: [Direction 360 rose] [Speed vs Direction] [Direction axial 0-180] [Speed distribution]
 */
export default function SingleTrackView({ data, label, settings }: Props) {
  const raw = data.tracks[label];
  const { x, y } = applyFilters(raw.x, raw.y, data.roi, settings);
  const { frame, speedRaw, speedSmooth, dirDeg } = computeFrameSeries(x, y, settings.fps, settings.pxScale);
  const aboveMask = speedRaw.map((s) => s >= settings.minSpeed);
  const dirAbove = dirDeg.filter((_, i) => aboveMask[i]);
  const speedAbove = speedRaw.filter((_, i) => aboveMask[i]);
  const path = computePathStats(x, y, settings.pxScale, dirAbove);
  const { meanDeg, R } = axialMeanR(dirAbove, settings.polAngle);

  const colorVals = settings.colorMode === "speed" ? speedRaw : frame;
  const frameRange: [number, number] = frame.length ? [frame[0], frame[frame.length - 1]] : [0, 1];

  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gridTemplateRows: "480px 300px",
        gap: 10,
      }}
    >
      <div style={{ gridColumn: "1", gridRow: "1" }}>
        <TrackPanel x={x} y={y} roi={data.roi} colorVals={frame} colorMode={settings.colorMode}
          speedForColor={speedRaw} pathStats={path} selectedFrame={selectedFrame} onSelectFrame={setSelectedFrame} />
      </div>
      <div
        style={{
          gridColumn: "2 / span 3",
          gridRow: "1",
          display: "grid",
          gridTemplateRows: "1fr 1fr",
          gap: 8,
        }}
      >
        <DirectionPanel frame={frame} dirDeg={dirDeg} fps={settings.fps} colorVals={colorVals} xRange={frameRange} timeCutSec={settings.timeCutSec}
          selectedFrame={selectedFrame} onSelectFrame={setSelectedFrame} />
        <SpeedPanel frame={frame} speedRaw={speedRaw} speedSmooth={speedSmooth} xRange={frameRange} fps={settings.fps} timeCutSec={settings.timeCutSec}
          selectedFrame={selectedFrame} onSelectFrame={setSelectedFrame} />
      </div>
      <div style={{ gridColumn: "1", gridRow: "2" }}>
        <DirectionRosePanel dirDeg={dirDeg} polAngle={settings.polAngle} showPolLine={settings.showPolLine} />
      </div>
      <div style={{ gridColumn: "2", gridRow: "2" }}>
        <SpeedVsDirectionPanel dirDeg={dirDeg} speed={speedRaw} minSpeed={settings.minSpeed} colorVals={colorVals} />
      </div>
      <div style={{ gridColumn: "3", gridRow: "2" }}>
        <DirectionAxialPanel dirAbove={dirAbove} polAngle={settings.polAngle} meanDeg={meanDeg} R={R} />
      </div>
      <div style={{ gridColumn: "4", gridRow: "2" }}>
        <SpeedHistogramPanel speed={speedAbove} />
      </div>
    </div>
  );
}

function TrackPanel({
  x, y, roi, colorVals, colorMode, speedForColor, pathStats, selectedFrame, onSelectFrame,
}: {
  x: number[]; y: number[]; roi: TracksData["roi"];
  colorVals: number[]; colorMode: Settings["colorMode"]; speedForColor: number[];
  pathStats: { straightness: number; meanAbsTurnDeg: number; netDisp: number };
  selectedFrame: number | null; onSelectFrame: (frame: number) => void;
}) {
  const shapes = roi
    ? [
        {
          type: "circle" as const,
          xref: "x" as const,
          yref: "y" as const,
          x0: roi.cx - roi.diam / 2,
          x1: roi.cx + roi.diam / 2,
          y0: roi.cy - roi.diam / 2,
          y1: roi.cy + roi.diam / 2,
          line: { color: "#ccc", width: 1.5 },
        },
      ]
    : [];
  const colorSrc = colorMode === "speed" ? speedForColor : colorVals;
  const subtitle = Number.isFinite(pathStats.straightness)
    ? `SI=${pathStats.straightness.toFixed(2)} | turn=${pathStats.meanAbsTurnDeg.toFixed(1)}° | disp=${pathStats.netDisp.toFixed(0)}px`
    : "";
  // Track_X/Y rows are 0-indexed; the shared "frame" numbering elsewhere in
  // this view is 1-based (row i == frame i+1), so convert both ways here.
  const highlightIdx = selectedFrame != null ? selectedFrame - 1 : -1;
  const hasHighlight = highlightIdx >= 0 && highlightIdx < x.length
    && Number.isFinite(x[highlightIdx]) && Number.isFinite(y[highlightIdx]);

  const handleClick = (e: Readonly<{ points: ReadonlyArray<{ pointIndex?: number }> }>) => {
    const idx = e.points?.[0]?.pointIndex;
    if (idx != null) onSelectFrame(idx + 1);
  };

  return (
    <Plot
      data={[
        {
          x,
          y,
          type: "scattergl",
          mode: "markers",
          marker: { size: 5, color: colorSrc, colorscale: "Viridis" },
          hoverinfo: "none", // "skip" (unlike "none") also suppresses click events
        },
        ...(hasHighlight
          ? [
              {
                x: [x[highlightIdx]],
                y: [y[highlightIdx]],
                type: "scattergl" as const, // same canvas as the main trace, so it draws on top of it
                mode: "markers" as const,
                marker: { size: 12, color: "#e02424", line: { color: "white", width: 1.5 } },
                hoverinfo: "skip" as const,
                showlegend: false,
              },
            ]
          : []),
      ]}
      layout={baseLayout(`Track${subtitle ? `<br><span style="font-size:9px">${subtitle}</span>` : ""}`, {
        xaxis: { title: { text: "X (px)" }, gridcolor: gridColor },
        yaxis: { title: { text: "Y (px)" }, gridcolor: gridColor, autorange: "reversed", scaleanchor: "x" },
        shapes,
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={handleClick}
    />
  );
}

/** A vertical dashed line marking the time-cutoff frame, shared by the
 * Direction and Speed panels (mirrors the MATLAB app's xline). */
function timeCutShape(fps: number, timeCutSec: number | null) {
  if (timeCutSec == null || !Number.isFinite(timeCutSec)) return [];
  const cutFrame = timeCutSec * fps;
  return [
    {
      type: "line" as const,
      x0: cutFrame,
      x1: cutFrame,
      y0: 0,
      y1: 1,
      yref: "paper" as const,
      line: { color: "#cc2626", width: 1.5, dash: "dash" as const },
    },
  ];
}

/** A vertical solid line marking the frame selected by clicking a point in
 * the Track/Direction/Speed panel, shared by the Direction and Speed panels. */
function selectionShape(selectedFrame: number | null) {
  if (selectedFrame == null) return [];
  return [
    {
      type: "line" as const,
      x0: selectedFrame,
      x1: selectedFrame,
      y0: 0,
      y1: 1,
      yref: "paper" as const,
      line: { color: "#e02424", width: 1.3 },
    },
  ];
}

function DirectionPanel({
  frame, dirDeg, fps, colorVals, xRange, timeCutSec, selectedFrame, onSelectFrame,
}: {
  frame: number[]; dirDeg: number[]; fps: number; colorVals: number[];
  xRange: [number, number]; timeCutSec: number | null;
  selectedFrame: number | null; onSelectFrame: (frame: number) => void;
}) {
  const dirSmooth = circularMovingAverage(dirDeg, 5);
  const durationSec = frame.length ? frame[frame.length - 1] / fps : 0;
  const lineChunks = coloredLineChunks(frame, dirSmooth, colorVals, 8, 180);

  const handleClick = (e: Readonly<{ points: ReadonlyArray<{ x?: number }> }>) => {
    const f = e.points?.[0]?.x;
    if (f != null) onSelectFrame(Math.round(f));
  };

  return (
    <Plot
      data={[
        {
          x: frame,
          y: dirDeg,
          type: "scattergl",
          mode: "markers",
          marker: { size: 4, color: colorVals, colorscale: "Viridis", opacity: 0.5 },
          name: "Direction",
          hoverinfo: "none", // "skip" (unlike "none") also suppresses click events
        },
        ...lineChunks.map((c) => ({
          x: c.x,
          y: c.y,
          type: "scatter" as const,
          mode: "lines" as const,
          line: { color: c.color, width: 1.8 },
          hoverinfo: "skip" as const,
          showlegend: false,
        })),
      ]}
      layout={baseLayout("Direction", {
        xaxis: {
          title: { text: "Frame" },
          gridcolor: gridColor,
          domain: [0, 1],
          range: xRange,
        },
        xaxis2: {
          overlaying: "x",
          side: "top",
          range: [0, durationSec],
          title: { text: "Time (s)", font: { size: 9 } },
        },
        yaxis: {
          title: { text: "Dir (°)" },
          gridcolor: gridColor,
          range: [-180, 180],
          tickvals: [-180, -90, 0, 90, 180],
        },
        shapes: [...timeCutShape(fps, timeCutSec), ...selectionShape(selectedFrame)],
        margin: { l: 50, r: 20, t: 40, b: 10 },
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={handleClick}
    />
  );
}

function SpeedPanel({
  frame, speedRaw, speedSmooth, xRange, fps, timeCutSec, selectedFrame, onSelectFrame,
}: {
  frame: number[]; speedRaw: number[]; speedSmooth: number[];
  xRange: [number, number]; fps: number; timeCutSec: number | null;
  selectedFrame: number | null; onSelectFrame: (frame: number) => void;
}) {
  const handleClick = (e: Readonly<{ points: ReadonlyArray<{ x?: number }> }>) => {
    const f = e.points?.[0]?.x;
    if (f != null) onSelectFrame(Math.round(f));
  };

  return (
    <Plot
      data={[
        {
          x: frame,
          y: speedRaw,
          type: "scattergl",
          mode: "markers",
          marker: { size: 4, color: "#bbb", opacity: 0.5 },
          name: "Speed",
          hoverinfo: "none", // "skip" (unlike "none") also suppresses click events
        },
        {
          x: frame,
          y: speedSmooth,
          type: "scatter",
          mode: "lines",
          line: { color: "#333", width: 1.8 },
          name: "Speed (smoothed)",
          hoverinfo: "skip",
        },
      ]}
      layout={baseLayout("Speed", {
        xaxis: {
          title: { text: "Frame" },
          gridcolor: gridColor,
          domain: [0, 1],
          range: xRange,
        },
        yaxis: { title: { text: "Speed (px/s)" }, gridcolor: gridColor },
        shapes: [...timeCutShape(fps, timeCutSec), ...selectionShape(selectedFrame)],
        margin: { l: 50, r: 20, t: 24, b: 36 },
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={handleClick}
    />
  );
}

function DirectionRosePanel({
  dirDeg, polAngle, showPolLine,
}: { dirDeg: number[]; polAngle: number; showPolLine: boolean }) {
  const nBins = 24;
  const counts = new Array(nBins).fill(0);
  for (const d of dirDeg) {
    const idx = Math.min(nBins - 1, Math.floor((((d + 180) % 360) / 360) * nBins));
    counts[idx]++;
  }
  const total = dirDeg.length || 1;
  const theta = Array.from({ length: nBins }, (_, i) => -180 + (360 / nBins) * (i + 0.5));
  const r = counts.map((c) => c / total);
  const maxR = Math.max(...r, 1e-6) * 1.15;

  return (
    <Plot
      data={[
        {
          type: "barpolar",
          r,
          theta,
          marker: { color: "#444", opacity: 0.85 },
        },
        ...(showPolLine
          ? [
              {
                type: "scatterpolar" as const,
                mode: "lines" as const,
                r: [maxR, 0, maxR],
                theta: [polAngle, polAngle, polAngle + 180],
                line: { color: "#111", width: 1.3 },
                hoverinfo: "skip" as const,
              },
            ]
          : []),
      ]}
      layout={baseLayout("Direction (360°)", {
        polar: {
          radialaxis: { showticklabels: false, ticks: "", layer: "below traces", range: [0, maxR] },
          angularaxis: {
            direction: "clockwise", // mirrors Y to match the video-orientation Track panel
            rotation: 0,
            tickvals: [0, 90, 180, 270],
            ticktext: ["0°", "90°", "180°", "-90°"],
            layer: "below traces",
          },
          bgcolor: "white",
        },
        showlegend: false,
        annotations: polAngle
          ? [{ text: `pol=${polAngle}°`, showarrow: false, x: 0.5, y: -0.08, xref: "paper", yref: "paper", font: { size: 9 } }]
          : [],
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

function SpeedVsDirectionPanel({
  dirDeg, speed, minSpeed, colorVals,
}: { dirDeg: number[]; speed: number[]; minSpeed: number; colorVals: number[] }) {
  const faded = { x: [] as number[], y: [] as number[] };
  const main = { x: [] as number[], y: [] as number[], c: [] as number[] };
  dirDeg.forEach((d, i) => {
    if (speed[i] < minSpeed) {
      faded.x.push(d);
      faded.y.push(speed[i]);
    } else {
      main.x.push(d);
      main.y.push(speed[i]);
      main.c.push(colorVals[i]);
    }
  });
  return (
    <Plot
      data={[
        { x: faded.x, y: faded.y, type: "scattergl", mode: "markers", marker: { size: 5, color: "#aaa", opacity: 0.25 }, hoverinfo: "skip" },
        { x: main.x, y: main.y, type: "scattergl", mode: "markers", marker: { size: 5, color: main.c, colorscale: "Viridis", opacity: 0.7 }, hoverinfo: "skip" },
      ]}
      layout={baseLayout("Speed vs Direction", {
        xaxis: { title: { text: "Direction (°)" }, range: [-180, 180], tickvals: [-180, -90, 0, 90, 180], gridcolor: gridColor },
        yaxis: { title: { text: "Speed (px/s)" }, gridcolor: gridColor },
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

function DirectionAxialPanel({
  dirAbove, polAngle, meanDeg, R,
}: { dirAbove: number[]; polAngle: number; meanDeg: number; R: number }) {
  const edges = Array.from({ length: 19 }, (_, i) => i * 10);
  const counts = new Array(18).fill(0);
  for (const d of dirAbove) {
    const ax = (((d - polAngle) % 180) + 180) % 180;
    const idx = Math.min(17, Math.floor(ax / 10));
    counts[idx]++;
  }
  const centers = edges.slice(0, -1).map((e) => e + 5);
  const subtitle = Number.isFinite(meanDeg) ? `mean ${meanDeg.toFixed(1)}° | R=${R.toFixed(3)}` : "";
  return (
    <Plot
      data={[{ x: centers, y: counts, type: "bar", marker: { color: "#444", line: { color: "white", width: 1 } }, width: 10 }]}
      layout={baseLayout(`Direction (axial)${subtitle ? `<br><span style="font-size:9px">${subtitle}</span>` : ""}`, {
        xaxis: { title: { text: "Direction (°)" }, range: [0, 180], tickvals: [0, 45, 90, 135, 180], gridcolor: gridColor },
        yaxis: { title: { text: "Count" }, gridcolor: gridColor },
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

function SpeedHistogramPanel({ speed }: { speed: number[] }) {
  return (
    <Plot
      data={[{ x: speed, type: "histogram", marker: { color: "#444", line: { color: "white", width: 1 } }, nbinsx: 20 }]}
      layout={baseLayout("Speed Distribution", {
        xaxis: { title: { text: "Speed (px/s)" }, gridcolor: gridColor },
        yaxis: { title: { text: "Count" }, gridcolor: gridColor },
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}
