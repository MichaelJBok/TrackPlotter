import { useEffect } from "react";
import Plot from "react-plotly.js";
import type { BackgroundImage, TracksData, Settings, TrackStats } from "../lib/types";
import { applyFilters, computeTrackStats } from "../lib/analysis";
import { colorForIndex } from "../lib/palette";
import { basePlotConfig, baseLayout, gridColor, roiShapes } from "../lib/plotDefaults";
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
 * track/bar/point jumps to that individual's single-track view. */
export default function OverviewView({ data, settings, onJumpToTrack, bgImage, registerCsvExport }: Props) {
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
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gridTemplateRows: "420px 300px",
          gap: 10,
        }}
      >
        <div style={{ gridColumn: "1", gridRow: "1 / span 2" }}>
          <XYOverlayPanel data={data} settings={settings} bgImage={bgImage} onClick={handlePlotlyClick} />
        </div>
        <div style={{ gridColumn: "2", gridRow: "1" }}>
          <DirectionPolarPanel stats={stats} onClick={handlePlotlyClick} />
        </div>
        <div style={{ gridColumn: "2", gridRow: "2", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <BarPanel title="Distance" stats={stats} valueOf={(s) => s.totalDist} unit="px" onClick={handlePlotlyClick} />
          <BarPanel title="Speed" stats={stats} valueOf={(s) => s.meanSpeed} unit="px/s" onClick={handlePlotlyClick} />
        </div>
      </div>
    </>
  );
}

function XYOverlayPanel({
  data, settings, bgImage, onClick,
}: { data: TracksData; settings: Settings; bgImage?: BackgroundImage; onClick: (e: any) => void }) {
  const traces = data.trackLabels.map((label, i) => {
    const raw = data.tracks[label];
    const { x, y } = applyFilters(raw.x, raw.y, data.roi, settings);
    const color = colorForIndex(i);
    return {
      x,
      y,
      type: "scattergl" as const,
      mode: "lines+markers" as const,
      name: label,
      line: { color, width: 1.2 },
      marker: { size: 4, color, opacity: 0.6 },
    };
  });

  const shapes = roiShapes(data.roi, settings.roiFilterPct);

  const images = bgImage
    ? [
        {
          source: bgImage.url,
          xref: "x" as const,
          yref: "y" as const,
          x: 0,
          y: 0,
          sizex: bgImage.width,
          sizey: bgImage.height,
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
      layout={baseLayout("All individuals — XY tracks", {
        xaxis: { title: { text: "X (px)" }, gridcolor: gridColor },
        yaxis: { title: { text: "Y (px)" }, gridcolor: gridColor, autorange: "reversed", scaleanchor: "x" },
        shapes,
        images,
        showlegend: true,
        legend: { font: { size: 9 } },
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={onClick}
    />
  );
}

function DirectionPolarPanel({ stats, onClick }: { stats: TrackStats[]; onClick: (e: any) => void }) {
  const traces = stats
    .map((s, i) => {
      if (!Number.isFinite(s.meanAxialDirDeg) || !Number.isFinite(s.vectorR)) return null;
      const color = colorForIndex(i);
      // Axial: plot the direction and its 180-flip, joined through the
      // center, since a direction and its mirror are the same axis.
      return {
        r: [s.vectorR, 0, s.vectorR],
        theta: [s.meanAxialDirDeg, s.meanAxialDirDeg, s.meanAxialDirDeg + 180],
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
      layout={baseLayout("Direction (R, mean axial angle)", {
        polar: {
          radialaxis: { range: [0, 1], showticklabels: false, ticks: "" },
          angularaxis: {
            direction: "clockwise",
            rotation: 0,
            tickvals: [0, 90, 180, 270],
            ticktext: ["0°", "90°", "180°", "-90°"],
          },
          bgcolor: "white",
        },
        showlegend: false,
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={onClick}
    />
  );
}

function BarPanel({
  title, stats, valueOf, unit, onClick,
}: { title: string; stats: TrackStats[]; valueOf: (s: TrackStats) => number; unit: string; onClick: (e: any) => void }) {
  const traces = stats.map((s, i) => ({
    x: [s.label],
    y: [Number.isFinite(valueOf(s)) ? valueOf(s) : 0],
    type: "bar" as const,
    name: s.label,
    marker: { color: colorForIndex(i) },
    showlegend: false,
  }));
  return (
    <Plot
      data={traces}
      layout={baseLayout(title, {
        xaxis: { tickfont: { size: 8 }, tickangle: -45 },
        yaxis: { title: { text: unit }, gridcolor: gridColor },
        margin: { l: 44, r: 10, t: 28, b: 50 },
      })}
      config={basePlotConfig}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={onClick}
    />
  );
}
