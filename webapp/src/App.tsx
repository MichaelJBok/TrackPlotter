import { useEffect, useMemo, useRef, useState } from "react";
import { parseTracksCsv } from "./lib/parseCsv";
import { applyFilters, computeTrackStats } from "./lib/analysis";
import { backgroundImageTag, loadBackgroundImage } from "./lib/backgroundImage";
import { collectFiles, directoryPickerSupported } from "./lib/directoryPicker";
import { downloadCsv } from "./lib/exportCsv";
import { exportAllVisiblePlots } from "./lib/plotDefaults";
import { loadCoreOverrides, loadSettings, saveCoreOverrides, saveSettings } from "./lib/settingsStorage";
import { type BackgroundImage, type CoreSettings, type Settings } from "./lib/types";
import OverviewView from "./components/OverviewView";
import SingleTrackView from "./components/SingleTrackView";
import ListBox from "./components/ListBox";

/** The tag a tracks CSV's filename shares with its matching "<tag>_bg.*"
 * background image (see backgroundImage.ts). */
function experimentTag(csvFilename: string): string {
  return csvFilename.replace(/_tracks\.csv$/i, "").replace(/\.csv$/i, "");
}

const OVERVIEW = "__overview__";

export default function App() {
  // Each uploaded file stays its own separate dataset (own tracks, own ROI) -
  // loading several just adds more options to pick from, it never merges them.
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  // Background images are matched to an experiment by tag (see experimentTag)
  // and kept separate from the CSVs themselves - loading one never merges
  // anything, it just gives that experiment's Overview plot a backdrop.
  const [backgroundImages, setBackgroundImages] = useState<Record<string, BackgroundImage>>({});
  const [bgErrors, setBgErrors] = useState<string[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<string>(OVERVIEW);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // FPS/ROI diameter/Min speed/Max ROI%/Color/Pol angle depend on the video,
  // not the viewer, so each experiment can override them; everything else in
  // `settings` stays global. Persisted by filename (unlike the loaded data
  // itself), so re-loading the same folder reattaches these automatically.
  // Pol angle is per-experiment too, but - unlike the others - it's never
  // included when "Apply to all" broadcasts one experiment's core settings
  // to the rest (see handleApplyToAll).
  const [coreOverrides, setCoreOverrides] = useState<Record<string, CoreSettings>>(loadCoreOverrides);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);
  useEffect(() => {
    saveCoreOverrides(coreOverrides);
  }, [coreOverrides]);
  // Whichever view is mounted (Overview or SingleTrack) registers its own
  // CSV-export logic here, since it depends on data computed inside that
  // view - the sidebar just calls whatever's currently registered.
  const csvExportRef = useRef<(() => void) | null>(null);
  const registerCsvExport = (fn: () => void) => {
    csvExportRef.current = fn;
  };
  const [figuresExporting, setFiguresExporting] = useState(false);

  const data = useMemo(
    () => (activeFile ? parseTracksCsv(uploadedFiles[activeFile]) : null),
    [activeFile, uploadedFiles],
  );
  const hasOverview = (data?.trackLabels.length ?? 0) > 0; // always show it, single- or multi-individual
  const uploadedNames = Object.keys(uploadedFiles);
  const bgImage = activeFile ? backgroundImages[experimentTag(activeFile)] : undefined;

  // What the active experiment actually sees: global settings, with its own
  // FPS/ROI diameter/Min speed/Max ROI%/Color/Pol angle override layered on
  // top, if any, plus pxScale derived from that ROI diameter - the ROI's
  // real-world diameter in cm ÷ its pixel diameter (read from the loaded CSV) - instead
  // of asking for a pre-computed px-per-cm ratio.
  const roiPixelDiam = data?.roi?.diam ?? null;
  const mergedCore: Settings = {
    ...settings,
    ...(activeFile ? coreOverrides[activeFile] : undefined),
  };
  const derivedPxScale = mergedCore.roiDiameterReal > 0 && roiPixelDiam
    ? mergedCore.roiDiameterReal / roiPixelDiam
    : 1;
  const effectiveSettings: Settings = { ...mergedCore, pxScale: derivedPxScale };
  const dark = settings.darkMode;

  function updateCoreSetting(patch: Partial<CoreSettings>) {
    if (!activeFile) {
      setSettings((s) => ({ ...s, ...patch }));
      return;
    }
    const { fps, roiDiameterReal, minSpeed, roiFilterPct, colorMode, polAngle } = effectiveSettings;
    setCoreOverrides((prev) => ({
      ...prev,
      [activeFile]: { fps, roiDiameterReal, minSpeed, roiFilterPct, colorMode, polAngle, ...patch },
    }));
  }

  function updateGlobalSetting(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
  }

  // Broadcasts Color/FPS/ROI diameter/Min speed/Max ROI% to every loaded
  // experiment - Pol angle is deliberately left out (see coreOverrides'
  // declaration above) and each experiment keeps whatever Pol angle it had.
  function handleApplyToAll() {
    const { fps, roiDiameterReal, minSpeed, roiFilterPct, colorMode } = effectiveSettings;
    setCoreOverrides((prev) =>
      Object.fromEntries(
        uploadedNames.map((name) => [
          name,
          { fps, roiDiameterReal, minSpeed, roiFilterPct, colorMode, polAngle: prev[name]?.polAngle ?? settings.polAngle },
        ]),
      ),
    );
  }

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

  // A folder drop just sorts every file by extension and feeds each half
  // through the same path as the individual pickers - anything else
  // (.DS_Store, notes, ...) is silently ignored, not reported as an error.
  async function loadFolderFiles(files: File[]) {
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

  async function handleFolderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    await loadFolderFiles(files);
  }

  /** Chrome/Edge path: a real directory handle via the File System Access
   * API. Falls back to the plain <input webkitdirectory> picker
   * (handleFolderUpload) on browsers without it (Firefox/Safari). */
  async function handlePickFolder() {
    if (!directoryPickerSupported) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: "read" });
      await loadFolderFiles(await collectFiles(handle));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFileErrors([`Couldn't read the folder: ${(err as Error).message}`]);
      }
    }
  }

  async function handleExportFigures(format: "png" | "pdf") {
    setFiguresExporting(true);
    try {
      await exportAllVisiblePlots(format);
    } finally {
      setFiguresExporting(false);
    }
  }

  /** One CSV with every track's stats from every loaded experiment, each
   * computed with that experiment's own effective settings (its core
   * override, if any, and pxScale derived from its own ROI) - not just
   * whichever experiment happens to be active right now. */
  function handleExportAllStats() {
    const header = [
      "Experiment", "Label", "N_valid", "TotalDist_px", "MeanSpeed_px_s", "MedianSpeed_px_s",
      "Straightness", "MeanAbsTurn_deg", "NetDisp_px", "MeanAxialDir_deg", "VectorR",
    ];
    const rows: Array<Array<string | number>> = [];
    for (const name of uploadedNames) {
      const expData = parseTracksCsv(uploadedFiles[name]);
      const core: Settings = { ...settings, ...(coreOverrides[name] ?? undefined) };
      const pxScale = core.roiDiameterReal > 0 && expData.roi?.diam
        ? core.roiDiameterReal / expData.roi.diam
        : 1;
      const expSettings: Settings = { ...core, pxScale };
      for (const label of expData.trackLabels) {
        const raw = expData.tracks[label];
        const { x, y } = applyFilters(raw.x, raw.y, expData.roi, expSettings);
        const s = computeTrackStats(label, x, y, expSettings);
        rows.push([
          name, s.label, s.nValid, s.totalDist, s.meanSpeed, s.medianSpeed,
          s.straightness, s.meanAbsTurnDeg, s.netDisp, s.meanAxialDirDeg, s.vectorR,
        ]);
      }
    }
    downloadCsv("all_experiments_track_stats.csv", header, rows);
  }

  return (
    <div className={dark ? "dark" : undefined} style={{ display: "flex", height: "100vh" }}>
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          boxSizing: "border-box",
          padding: 16,
          overflowY: "auto",
          borderRight: "1px solid #ddd",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <h1 style={{ fontSize: 16, margin: 0, color: dark ? "#8fb4e3" : "#1f3a63" }}>TrackPlotter</h1>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Data</SectionLabel>
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
          <button type="button" style={{ fontSize: 13 }} onClick={handlePickFolder}>
            Load folder…
          </button>
          <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
            Loads every tracks CSV in the folder, plus any matching "&lt;experiment&gt;_bg.jpg/png" background
            images - CSVs load fine on their own if there are no images.
          </p>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Experiment</SectionLabel>
          <ListBox
            items={uploadedNames}
            value={activeFile}
            onSelect={handleFileChange}
            placeholder="Search experiments…"
            emptyMessage="No data loaded"
            dark={dark}
          />
          {data && (
            <>
              <SectionLabel>Animal</SectionLabel>
              {hasOverview && (
                <button
                  type="button"
                  onClick={() => setSelection(OVERVIEW)}
                  style={{
                    fontSize: 12,
                    textAlign: "left",
                    padding: "2px 6px",
                    background: selection === OVERVIEW ? (dark ? "#2c4a7c" : "#dce7f7") : undefined,
                  }}
                >
                  — Overview (ALL individuals) —
                </button>
              )}
              <ListBox
                items={data.trackLabels}
                value={selection}
                onSelect={setSelection}
                showSearch={false}
                dark={dark}
              />
            </>
          )}
        </section>

        <SettingsBar
          settings={effectiveSettings}
          onChangeGlobal={updateGlobalSetting}
          onChangeCore={updateCoreSetting}
          onApplyToAll={handleApplyToAll}
          canApplyToAll={uploadedNames.length > 1}
          roiPixelDiam={roiPixelDiam}
          dark={dark}
        />

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Export</SectionLabel>
          <button
            type="button"
            style={{ fontSize: 12 }}
            disabled={!data}
            onClick={() => csvExportRef.current?.()}
          >
            Export data (CSV)
          </button>
          <button
            type="button"
            style={{ fontSize: 12 }}
            disabled={!data || figuresExporting}
            onClick={() => handleExportFigures("png")}
          >
            Export figures (PNG)
          </button>
          <button
            type="button"
            style={{ fontSize: 12 }}
            disabled={!data || figuresExporting}
            onClick={() => handleExportFigures("pdf")}
          >
            Export figures (PDF)
          </button>
          <button
            type="button"
            style={{ fontSize: 12 }}
            disabled={uploadedNames.length === 0}
            title="One CSV with every track's stats from every loaded experiment"
            onClick={handleExportAllStats}
          >
            Export all stats (CSV)
          </button>
        </section>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 16, boxSizing: "border-box" }}>
        {(fileErrors.length > 0 || bgErrors.length > 0) && (
          <div style={{ color: "#c0392b", fontSize: 12, marginBottom: 12 }}>
            {[...fileErrors, ...bgErrors].map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        )}

        {!data ? (
          <p style={{ color: dark ? "#aaa" : "#666", fontSize: 14 }}>
            Load a folder of tracks CSVs from the sidebar to get started. Nothing you load is ever sent
            anywhere - it's read directly off your disk and stays in this browser tab.
          </p>
        ) : selection === OVERVIEW ? (
          <OverviewView
            data={data}
            settings={effectiveSettings}
            onJumpToTrack={setSelection}
            bgImage={bgImage}
            registerCsvExport={registerCsvExport}
          />
        ) : (
          <SingleTrackView
            data={data}
            label={selection}
            settings={effectiveSettings}
            registerCsvExport={registerCsvExport}
          />
        )}
      </main>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.3 }}>
      {children}
    </div>
  );
}

const fieldRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};
const numberInput: React.CSSProperties = { width: 60 };

/** Accepts "," as a decimal separator too (common outside en-US locales),
 * since a plain Number() rejects it outright. */
function parseLocaleNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

/** A number field that tracks what you're literally typing, instead of
 * snapping back to the parsed number on every keystroke - a plain
 * `<input value={aNumber} onChange={...parse...}>` re-renders with
 * `value` already rounded to the parsed number, which erases a trailing
 * "." or "," (and the digits after it never get a chance to land) before
 * you can type the next character. Only resyncs its own displayed text
 * from `value` when something *else* changed it (switching experiments,
 * Apply to all, ...), not as a result of its own onChange. */
function DecimalField({
  value, onChange, fallback, style, disabled, title,
}: {
  value: number; onChange: (n: number) => void; fallback: number;
  style?: React.CSSProperties; disabled?: boolean; title?: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    if (parseLocaleNumber(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      title={title}
      style={style}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = parseLocaleNumber(raw);
        if (Number.isFinite(n)) onChange(n || fallback);
      }}
    />
  );
}

/** Border/background wrapped around exactly the fields "Apply to all
 * experiments" broadcasts, so it's visually obvious what that button does
 * and doesn't touch (Pol angle, just below, is the deliberate exception). */
const applyToAllGroup: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  border: "1px solid #a9c4e8",
  borderRadius: 6,
  padding: 8,
};

function SettingsBar({
  settings, onChangeGlobal, onChangeCore, onApplyToAll, canApplyToAll, roiPixelDiam, dark,
}: {
  settings: Settings;
  onChangeGlobal: (patch: Partial<Settings>) => void;
  onChangeCore: (patch: Partial<CoreSettings>) => void;
  onApplyToAll: () => void;
  canApplyToAll: boolean;
  roiPixelDiam: number | null;
  dark: boolean;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
      <SectionLabel>Settings</SectionLabel>
      <div
        style={{
          ...applyToAllGroup,
          borderColor: dark ? "#3a5a8c" : "#a9c4e8",
          background: dark ? "#192334" : "#f3f7fd",
        }}
      >
        <label style={fieldRow}>
          Color
          <select
            value={settings.colorMode}
            onChange={(e) => onChangeCore({ colorMode: e.target.value as Settings["colorMode"] })}
          >
            <option value="time">time</option>
            <option value="speed">speed</option>
          </select>
        </label>
        <label style={fieldRow}>
          FPS
          <DecimalField
            value={settings.fps}
            fallback={1}
            style={numberInput}
            onChange={(fps) => onChangeCore({ fps })}
          />
        </label>
        <label style={fieldRow}>
          ROI diameter (cm)
          <DecimalField
            value={settings.roiDiameterReal}
            fallback={0}
            title="Real-world diameter of the ROI, in cm - 0 stays in px"
            style={numberInput}
            onChange={(roiDiameterReal) => onChangeCore({ roiDiameterReal })}
          />
        </label>
        {roiPixelDiam != null && (
          <div style={{ fontSize: 10, color: "#888", marginTop: -4 }}>
            {settings.roiDiameterReal > 0
              ? `ROI is ${roiPixelDiam.toFixed(0)} px across → 1 px = ${(settings.roiDiameterReal / roiPixelDiam).toFixed(4)} cm`
              : `ROI is ${roiPixelDiam.toFixed(0)} px across - set a diameter above to calibrate`}
          </div>
        )}
        <label style={fieldRow}>
          Min speed
          <DecimalField
            value={settings.minSpeed}
            fallback={0}
            style={numberInput}
            onChange={(minSpeed) => onChangeCore({ minSpeed })}
          />
        </label>
        <label style={fieldRow}>
          Max ROI%
          <DecimalField
            value={settings.roiFilterPct}
            fallback={0}
            style={numberInput}
            onChange={(roiFilterPct) => onChangeCore({ roiFilterPct })}
          />
        </label>
        <button
          type="button"
          disabled={!canApplyToAll}
          title="Copy Color/FPS/ROI diameter/Min speed/Max ROI% (everything in this box) from this experiment to every other loaded experiment"
          onClick={onApplyToAll}
        >
          Apply to all experiments
        </button>
      </div>
      <label style={fieldRow}>
        Pol angle
        <DecimalField
          value={settings.polAngle}
          fallback={0}
          title="Per-experiment - not included in Apply to all"
          style={numberInput}
          onChange={(polAngle) => onChangeCore({ polAngle })}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.darkMode}
          onChange={(e) => onChangeGlobal({ darkMode: e.target.checked })}
        />
        Dark mode
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.colorBlindMode}
          onChange={(e) => onChangeGlobal({ colorBlindMode: e.target.checked })}
        />
        Colorblind mode (Overview)
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.showPolLine}
          onChange={(e) => onChangeGlobal({ showPolLine: e.target.checked })}
        />
        Show pol line
      </label>
      <label style={fieldRow}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.timeCutSec != null}
            onChange={(e) => onChangeGlobal({ timeCutSec: e.target.checked ? 0 : null })}
          />
          Time cut (s)
        </span>
        <DecimalField
          value={settings.timeCutSec ?? 0}
          fallback={0}
          disabled={settings.timeCutSec == null}
          style={numberInput}
          onChange={(timeCutSec) => onChangeGlobal({ timeCutSec })}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.lockSpeedAxis}
          onChange={(e) => onChangeGlobal({ lockSpeedAxis: e.target.checked })}
        />
        Lock speed axis
      </label>
      <label style={fieldRow}>
        Speed pctile
        <DecimalField
          value={settings.speedPercentile}
          fallback={95}
          disabled={!settings.lockSpeedAxis}
          style={numberInput}
          onChange={(speedPercentile) => onChangeGlobal({ speedPercentile })}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.lockHistAxis}
          onChange={(e) => onChangeGlobal({ lockHistAxis: e.target.checked })}
        />
        Lock hist Y axis
      </label>
    </section>
  );
}
