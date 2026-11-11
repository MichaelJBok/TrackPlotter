import { useMemo, useRef, useState } from "react";
import { parseTracksCsv } from "./lib/parseCsv";
import { backgroundImageTag, loadBackgroundImage } from "./lib/backgroundImage";
import { DEFAULT_SETTINGS, type BackgroundImage, type Settings } from "./lib/types";
import OverviewView from "./components/OverviewView";
import SingleTrackView from "./components/SingleTrackView";

/** The tag a tracks CSV's filename shares with its matching "<tag>_bg.*"
 * background image (see backgroundImage.ts). */
function experimentTag(csvFilename: string): string {
  return csvFilename.replace(/_tracks\.csv$/i, "").replace(/\.csv$/i, "");
}

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
  // Each uploaded file stays its own separate dataset (own tracks, own ROI) -
  // loading several just adds more options to pick from, it never merges them.
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string>(Object.keys(FIXTURES)[0]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Background images are matched to an experiment by tag (see experimentTag)
  // and kept separate from the CSVs themselves - loading one never merges
  // anything, it just gives that experiment's Overview plot a backdrop.
  const [backgroundImages, setBackgroundImages] = useState<Record<string, BackgroundImage>>({});
  const [bgErrors, setBgErrors] = useState<string[]>([]);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<string>(OVERVIEW);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const data = useMemo(
    () => parseTracksCsv(uploadedFiles[activeFile] ?? FIXTURES[activeFile]),
    [activeFile, uploadedFiles],
  );
  const hasOverview = data.trackLabels.length > 0; // always show it, single- or multi-individual
  const uploadedNames = Object.keys(uploadedFiles);
  const bgImage = backgroundImages[experimentTag(activeFile)];

  function handleFileChange(name: string) {
    setActiveFile(name);
    setSelection(OVERVIEW); // always land on Overview for a newly selected file
  }

  async function ingestCsvFiles(files: File[]) {
    const errors: string[] = [];
    const entries: Record<string, string> = {};
    let firstGood: string | null = null;
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = parseTracksCsv(text);
        if (parsed.trackLabels.length === 0) {
          errors.push(`"${file.name}" doesn't look like a tracks CSV (no Label_X/Label_Y columns found).`);
          continue;
        }
        entries[file.name] = text;
        if (firstGood === null) firstGood = file.name;
      } catch (err) {
        errors.push(`Couldn't read "${file.name}": ${(err as Error).message}`);
      }
    }
    return { errors, entries, firstGood };
  }

  async function ingestBackgroundFiles(files: File[]) {
    const errors: string[] = [];
    const entries: Record<string, BackgroundImage> = {};
    for (const file of files) {
      const tag = backgroundImageTag(file.name);
      if (!tag) {
        errors.push(`"${file.name}" doesn't look like a "<experiment>_bg.jpg/png" background image.`);
        continue;
      }
      try {
        entries[tag] = await loadBackgroundImage(file);
      } catch (err) {
        errors.push(`Couldn't read "${file.name}": ${(err as Error).message}`);
      }
    }
    return { errors, entries };
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same filename(s) later
    if (files.length === 0) return;
    const { errors, entries, firstGood } = await ingestCsvFiles(files);
    setFileErrors(errors);
    if (firstGood) {
      setUploadedFiles((prev) => ({ ...prev, ...entries }));
      setActiveFile(firstGood);
      setSelection(OVERVIEW);
    }
  }

  async function handleFolderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    // A folder drop just sorts every file by extension and feeds each half
    // through the same path as the individual pickers - anything else
    // (.DS_Store, notes, ...) is silently ignored, not reported as an error.
    const csvFiles = files.filter((f) => /\.csv$/i.test(f.name));
    const imageFiles = files.filter((f) => /\.(jpe?g|png)$/i.test(f.name));
    const [csvResult, imgResult] = await Promise.all([
      ingestCsvFiles(csvFiles),
      ingestBackgroundFiles(imageFiles),
    ]);
    setFileErrors(csvResult.errors);
    setBgErrors(imgResult.errors);
    if (csvResult.firstGood) {
      setUploadedFiles((prev) => ({ ...prev, ...csvResult.entries }));
      setActiveFile(csvResult.firstGood);
      setSelection(OVERVIEW);
    }
    if (Object.keys(imgResult.entries).length > 0) {
      setBackgroundImages((prev) => ({ ...prev, ...imgResult.entries }));
    }
  }

  function handleClearUploads() {
    setUploadedFiles({});
    setFileErrors([]);
    setActiveFile(Object.keys(FIXTURES)[0]);
    setSelection(OVERVIEW);
    handleClearBackgrounds();
  }

  async function handleBackgroundUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const { errors, entries } = await ingestBackgroundFiles(files);
    setBgErrors(errors);
    if (Object.keys(entries).length > 0) {
      setBackgroundImages((prev) => ({ ...prev, ...entries }));
    }
  }

  function handleClearBackgrounds() {
    Object.values(backgroundImages).forEach((img) => URL.revokeObjectURL(img.url));
    setBackgroundImages({});
    setBgErrors([]);
  }

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, margin: 0, color: "#1f3a63" }}>TrackPlotter (web prototype)</h1>
        <label>
          Experiment:{" "}
          <select value={activeFile} onChange={(e) => handleFileChange(e.target.value)}>
            {uploadedNames.length > 0 && (
              <optgroup label="Loaded files">
                {uploadedNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Sample data">
              {Object.keys(FIXTURES).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <input
          type="file"
          accept=".csv"
          multiple
          ref={fileInputRef}
          onChange={handleFileUpload}
          style={{ display: "none" }}
        />
        <button type="button" style={{ fontSize: 12 }} onClick={() => fileInputRef.current?.click()}>
          Load CSV(s) from disk…
        </button>
        <input
          type="file"
          multiple
          ref={(el) => {
            if (el) {
              el.setAttribute("webkitdirectory", "");
              el.setAttribute("directory", "");
            }
            folderInputRef.current = el;
          }}
          onChange={handleFolderUpload}
          style={{ display: "none" }}
        />
        <button type="button" style={{ fontSize: 12 }} onClick={() => folderInputRef.current?.click()}>
          Load folder…
        </button>
        {uploadedNames.length > 0 && (
          <button type="button" style={{ fontSize: 12 }} onClick={handleClearUploads}>
            Clear loaded files
          </button>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png"
          multiple
          ref={bgInputRef}
          onChange={handleBackgroundUpload}
          style={{ display: "none" }}
        />
        <button type="button" style={{ fontSize: 12 }} onClick={() => bgInputRef.current?.click()}>
          Load background image(s)…
        </button>
        {Object.keys(backgroundImages).length > 0 && (
          <button type="button" style={{ fontSize: 12 }} onClick={handleClearBackgrounds}>
            Clear backgrounds
          </button>
        )}
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
      {(fileErrors.length > 0 || bgErrors.length > 0) && (
        <div style={{ color: "#c0392b", fontSize: 12, marginTop: -8, marginBottom: 12 }}>
          {[...fileErrors, ...bgErrors].map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
        </div>
      )}

      {selection === OVERVIEW ? (
        <OverviewView data={data} settings={settings} onJumpToTrack={setSelection} bgImage={bgImage} />
      ) : (
        <SingleTrackView data={data} label={selection} settings={settings} />
      )}
    </div>
  );
}

function SettingsBar({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12, marginLeft: "auto", alignItems: "center", flexWrap: "wrap" }}>
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
        Px scale{" "}
        <input
          type="number"
          step="0.01"
          value={settings.pxScale}
          style={{ width: 55 }}
          onChange={(e) => onChange({ ...settings, pxScale: Number(e.target.value) || 1 })}
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
        Pol angle{" "}
        <input
          type="number"
          value={settings.polAngle}
          style={{ width: 50 }}
          onChange={(e) => onChange({ ...settings, polAngle: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.showPolLine}
          onChange={(e) => onChange({ ...settings, showPolLine: e.target.checked })}
        />{" "}
        Show pol line
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.timeCutSec != null}
          onChange={(e) => onChange({ ...settings, timeCutSec: e.target.checked ? 0 : null })}
        />{" "}
        Time cut (s){" "}
        <input
          type="number"
          disabled={settings.timeCutSec == null}
          value={settings.timeCutSec ?? 0}
          style={{ width: 50 }}
          onChange={(e) => onChange({ ...settings, timeCutSec: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.lockSpeedAxis}
          onChange={(e) => onChange({ ...settings, lockSpeedAxis: e.target.checked })}
        />{" "}
        Lock speed axis
      </label>
      <label>
        Speed pctile{" "}
        <input
          type="number"
          min={1}
          max={100}
          disabled={!settings.lockSpeedAxis}
          value={settings.speedPercentile}
          style={{ width: 45 }}
          onChange={(e) => onChange({ ...settings, speedPercentile: Number(e.target.value) || 95 })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.lockHistAxis}
          onChange={(e) => onChange({ ...settings, lockHistAxis: e.target.checked })}
        />{" "}
        Lock hist Y axis
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
