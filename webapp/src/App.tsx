import { useMemo, useState } from "react";
import { parseTracksCsv } from "./lib/parseCsv";
import { DEFAULT_SETTINGS, type Settings } from "./lib/types";
import OverviewView from "./components/OverviewView";
import SingleTrackView from "./components/SingleTrackView";

import i1Csv from "./fixtures/260814_GX010049_i1_tracks.csv?raw";
import dsCsv from "./fixtures/260826_GX010066_ds_tracks.csv?raw";
import pvCsv from "./fixtures/260902_GX010069_pv_tracks.csv?raw";
import phCsv from "./fixtures/260902_GX010069_ph_tracks.csv?raw";

const FIXTURES: Record<string, string> = {
  "260902_GX010069_pv_tracks.csv": pvCsv,
  "260902_GX010069_ph_tracks.csv": phCsv,
  "260814_GX010049_i1_tracks.csv": i1Csv,
  "260826_GX010066_ds_tracks.csv": dsCsv,
};

const OVERVIEW = "__overview__";

export default function App() {
  const [fileName, setFileName] = useState(Object.keys(FIXTURES)[0]);
  const [selection, setSelection] = useState<string>(OVERVIEW);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const data = useMemo(() => parseTracksCsv(FIXTURES[fileName]), [fileName]);
  const hasOverview = data.trackLabels.length > 0; // always show it, single- or multi-individual

  function handleFileChange(name: string) {
    setFileName(name);
    setSelection(OVERVIEW); // always land on Overview for a newly selected file
  }

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, margin: 0, color: "#1f3a63" }}>TrackPlotter (web prototype)</h1>
        <label>
          File:{" "}
          <select value={fileName} onChange={(e) => handleFileChange(e.target.value)}>
            {Object.keys(FIXTURES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Animal:{" "}
          <select value={selection} onChange={(e) => setSelection(e.target.value)}>
            {hasOverview && <option value={OVERVIEW}>— Overview (ALL individuals) —</option>}
            {data.trackLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <SettingsBar settings={settings} onChange={setSettings} />
      </header>

      {selection === OVERVIEW ? (
        <OverviewView data={data} settings={settings} onJumpToTrack={setSelection} />
      ) : (
        <SingleTrackView data={data} label={selection} settings={settings} />
      )}
    </div>
  );
}

function SettingsBar({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12, marginLeft: "auto", alignItems: "center" }}>
      <label>
        FPS{" "}
        <input
          type="number"
          value={settings.fps}
          style={{ width: 50 }}
          onChange={(e) => onChange({ ...settings, fps: Number(e.target.value) || 1 })}
        />
      </label>
      <label>
        Min speed{" "}
        <input
          type="number"
          value={settings.minSpeed}
          style={{ width: 50 }}
          onChange={(e) => onChange({ ...settings, minSpeed: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        Max ROI%{" "}
        <input
          type="number"
          value={settings.roiFilterPct}
          style={{ width: 50 }}
          onChange={(e) => onChange({ ...settings, roiFilterPct: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        Color{" "}
        <select
          value={settings.colorMode}
          onChange={(e) => onChange({ ...settings, colorMode: e.target.value as Settings["colorMode"] })}
        >
          <option value="time">time</option>
          <option value="speed">speed</option>
        </select>
      </label>
    </div>
  );
}
