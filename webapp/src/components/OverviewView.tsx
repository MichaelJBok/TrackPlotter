import { useEffect } from "react";
import Plot from "react-plotly.js";
import type { BackgroundImage, TracksData, Settings, TrackStats } from "../lib/types";
import { applyFilters, computeTrackStats } from "../lib/analysis";
import { colorForIndex } from "../lib/palette";
import { basePlotConfig, baseLayout, gridColor, gridColorDark, roiShapes } from "../lib/plotDefaults";
import { downloadCsv } from "../lib/exportCsv";

interface Props {
  data: TracksData;
  settings: Settings;
  onJumpToTrack: (label: string) => void;
  bgImage?: BackgroundImage;
  registerCsvExport: (fn: () => void) => void;
}

/** Multi-individual overview: XY overlay (+ optional background image), per-
 * individual distance/speed bars, and a direction polar plot. Clicking any
 * track/bar/point jumps to that individual's single-track view. Dark mode
 * applies everywhere; the colorblind-safe palette is scoped to this view
 * only, since it's the only one with a per-track categorical palette. */
export default function OverviewView({ data, settings, onJumpToTrack, bgImage, registerCsvExport }: Props) {
  const { darkMode: dark, colorBlindMode: cb } = settings;
  // "cm" once the ROI diameter calibration (Settings > ROI diameter) is
  // set, so distances/speeds read in real-world terms instead of raw px.
  const unit = settings.pxScale !== 1 ? "cm" : "px";
  const stats: TrackStats[] = data.trackLabels.map((label) => {
    const raw = data.tracks[label];
    const { x, y } = applyFilters(raw.x, raw.y, data.roi, settings);
    return computeTrackStats(label, x, y, settings);
  });

  const handlePlotlyClick = (e: Readonly<{ points: ReadonlyArray<{ data: { name?: string } }> }>) => {
    const name = e.points?.[0]?.data?.name;
    if (name && data.trackLabels.includes(name)) onJumpToTrack(name);
  };

  const handleExportStats = () => {
    const header = [
      "Label", "N_valid", "TotalDist_px", "MeanSpeed_px_s", "MedianSpeed_px_s",
      "Straightness", "MeanAbsTurn_deg", "NetDisp_px", "MeanAxialDir_deg", "VectorR",
    ];
    const rows = stats.map((s) => [
      s.label, s.nValid, s.totalDist, s.meanSpeed, s.medianSpeed,
      s.straightness, s.meanAbsTurnDeg, s.netDisp, s.meanAxialDirDeg, s.vectorR,
    ]);
    downloadCsv("track_stats.csv", header, rows);
  };

  // Hands the CSV-export trigger up to the sidebar, which doesn't have
  // direct access to `stats` - re-registers whenever it changes.
  useEffect(() => {
    registerCsvExport(handleExportStats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.6fr 1fr",
        gridTemplateRows: "420px 300px",
        gap: 10,
        background: dark ? "#141414" : undefined,
        padding: dark ? 10 : 0,
        borderRadius: dark ? 6 : 0,
      }}
    >
      <div style={{ gridColumn: "1", gridRow: "1 / span 2" }}>
        <XYOverlayPanel data={data} settings={settings} bgImage={bgImage} dark={dark} cb={cb} onClick={handlePlotlyClick} />
      </div>
      <div style={{ gridColumn: "2", gridRow: "1" }}>
        <DirectionPolarPanel stats={stats} polAngle={settings.polAngle} dark={dark} cb={cb} onClick={handlePlotlyClick} />
      </div>
      <div style={{ gridColumn: "2", gridRow: "2", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <BarPanel title="Distance" stats={stats} valueOf={(s) => s.totalDist} unit={unit} dark={dark} cb={cb} onClick={handlePlotlyClick} />
        <BarPanel title="Speed" stats={stats} valueOf={(s) => s.meanSpeed} unit={`${unit}/s`} dark={dark} cb={cb} onClick={handlePlotlyClick} />
      </div>
    </div>
  );
}

function XYOverlayPanel({
  data, settings, bgImage, dark, cb, onClick,
}: {
  data: TracksData; settings: Settings; bgImage?: BackgroundImage; dark: boolean; cb: boolean;
  onClick: (e: any) => void;
}) {
  // Positions are scaled to cm (pxScale) right at the point of plotting -
  // the ROI shapes and background image below get the same scale, so
  // everything spatial stays aligned; every other computation in this app
  // (speed, distance, ...) works from the raw, unscaled x/y.
  const unit = settings.pxScale !== 1 ? "cm" : "px";
  const traces = data.trackLabels.map((label, i) => {
    const raw = data.tracks[label];
    const { x, y } = applyFilters(raw.x, raw.y, data.roi, settings);
    const color = colorForIndex(i, cb);
    return {
      x: x.map((v) => v * settings.pxScale),
      y: y.map((v) => v * settings.pxScale),
      type: "scattergl" as const,
      mode: "lines+markers" as const,
      name: label,
      line: { color, width: 1.2 },
      marker: { size: 4, color, opacity: 0.6 },
    };
  });

  const shapes = roiShapes(data.roi, settings.roiFilterPct, settings.pxScale);

  const images = bgImage
    ? [
        {
          source: bgImage.url,
          xref: "x" as const,
          yref: "y" as const,
          x: 0,
          y: 0,
          sizex: bgImage.width * settings.pxScale,
          sizey: bgImage.height * settings.pxScale,
          xanchor: "left" as const,
          yanchor: "top" as const,
          sizing: "stretch" as const,
          layer: "below" as const,
        },
      ]
    : [];

  return (
    <Plot
      data={traces}
      layout={baseLayout(
        "All individuals — XY tracks",
        {
          xaxis: { title: { text: `X (${unit})` }, gridcolor: dark ? gridColorDark : gridColor },
          yaxis: {
            title: { text: `Y (${unit})` },
            gridcolor: dark ? gridColorDark : gridColor,
            autorange: "reversed",
            scaleanchor: "x",
          },
          shapes,
          images,
          showlegend: true,
          legend: { font: { size: 9 } },
        },
        dark,
      )}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={onClick}
    />
  );
}

function DirectionPolarPanel({
  stats, polAngle, dark, cb, onClick,
}: { stats: TrackStats[]; polAngle: number; dark: boolean; cb: boolean; onClick: (e: any) => void }) {
  const traces = stats
    .map((s, i) => {
      if (!Number.isFinite(s.meanAxialDirDeg) || !Number.isFinite(s.vectorR)) return null;
      const color = colorForIndex(i, cb);
      // s.meanAxialDirDeg is relative to Pol angle (see axialMeanR) - undo
      // that shift here so this plot stays fixed to the actual bearing and
      // doesn't rotate every time Pol angle changes; vectorR (the vector's
      // length) is unaffected by the shift either way.
      const absDeg = ((s.meanAxialDirDeg + polAngle) % 180 + 180) % 180;
      // Axial: plot the direction and its 180-flip, joined through the
      // center, since a direction and its mirror are the same axis.
      return {
        r: [s.vectorR, 0, s.vectorR],
        theta: [absDeg, absDeg, absDeg + 180],
        type: "scatterpolar" as const,
        mode: "lines+markers" as const,
        name: s.label,
        line: { color, width: 1.5 },
        marker: { size: 7, color },
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return (
    <Plot
      data={traces}
      layout={baseLayout(
        "Direction (R, mean axial angle)",
        {
          polar: {
            radialaxis: { range: [0, 1], showticklabels: false, ticks: "" },
            angularaxis: {
              direction: "clockwise",
              rotation: 0,
              tickvals: [0, 90, 180, 270],
              ticktext: ["0°", "90°", "180°", "-90°"],
              color: dark ? "#ccc" : undefined,
            },
            bgcolor: dark ? "#1e1e1e" : "white",
          },
          showlegend: false,
          // Extra headroom so the title doesn't sit on top of the polar
          // chart's own "90°" tick label just below it.
          margin: { l: 44, r: 20, t: 42, b: 36 },
        },
        dark,
      )}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={onClick}
    />
  );
}

function BarPanel({
  title, stats, valueOf, unit, dark, cb, onClick,
}: {
  title: string; stats: TrackStats[]; valueOf: (s: TrackStats) => number; unit: string;
  dark: boolean; cb: boolean; onClick: (e: any) => void;
}) {
  const traces = stats.map((s, i) => ({
    x: [s.label],
    y: [Number.isFinite(valueOf(s)) ? valueOf(s) : 0],
    type: "bar" as const,
    name: s.label,
    marker: { color: colorForIndex(i, cb) },
    showlegend: false,
  }));
  return (
    <Plot
      data={traces}
      layout={baseLayout(
        title,
        {
          xaxis: { tickfont: { size: 8 }, tickangle: -45 },
          yaxis: { title: { text: unit }, gridcolor: dark ? gridColorDark : gridColor },
          margin: { l: 44, r: 10, t: 28, b: 50 },
        },
        dark,
      )}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={onClick}
    />
  );
}
