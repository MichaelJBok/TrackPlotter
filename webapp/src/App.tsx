import { useMemo, useRef, useState } from "react";
import { parseTracksCsv } from "./lib/parseCsv";
import { backgroundImageTag, loadBackgroundImage } from "./lib/backgroundImage";
import { collectFiles, directoryPickerSupported } from "./lib/directoryPicker";
import { exportAllVisiblePlots } from "./lib/plotDefaults";
import { DEFAULT_SETTINGS, type BackgroundImage, type Settings } from "./lib/types";
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

  async function handleExportFigures(format: "png" | "pdf") {
    setFiguresExporting(true);
    try {
      await exportAllVisiblePlots(format);
    } finally {
      setFiguresExporting(false);
    }
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
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
        <h1 style={{ fontSize: 16, margin: 0, color: "#1f3a63" }}>TrackPlotter</h1>

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
            accept="image/jpeg,image/png"
            multiple
            ref={bgInputRef}
            onChange={handleBackgroundUpload}
            style={{ display: "none" }}
          />
          <button type="button" style={{ fontSize: 12 }} onClick={() => bgInputRef.current?.click()}>
            Load background image(s)…
          </button>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Experiment</SectionLabel>
          <ListBox
            items={uploadedNames}
            value={activeFile}
            onSelect={handleFileChange}
            placeholder="Search experiments…"
            emptyMessage="No data loaded"
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
                    background: selection === OVERVIEW ? "#dce7f7" : undefined,
                  }}
                >
                  — Overview (ALL individuals) —
                </button>
              )}
              <ListBox
                items={data.trackLabels}
                value={selection}
                onSelect={setSelection}
                placeholder="Search tracks…"
              />
            </>
          )}
        </section>

        <SettingsBar settings={settings} onChange={setSettings} />

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
          <p style={{ color: "#666", fontSize: 14 }}>
            Load a tracks CSV (or a whole folder of them) from the sidebar to get started. Nothing you load is
            ever sent anywhere - it's read directly off your disk and stays in this browser tab.
          </p>
        ) : selection === OVERVIEW ? (
          <OverviewView
            data={data}
            settings={settings}
            onJumpToTrack={setSelection}
            bgImage={bgImage}
            registerCsvExport={registerCsvExport}
          />
        ) : (
          <SingleTrackView data={data} label={selection} settings={settings} registerCsvExport={registerCsvExport} />
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

function SettingsBar({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
      <SectionLabel>Settings</SectionLabel>
      <label style={fieldRow}>
        FPS
        <input
          type="number"
          value={settings.fps}
          style={numberInput}
          onChange={(e) => onChange({ ...settings, fps: Number(e.target.value) || 1 })}
        />
      </label>
      <label style={fieldRow}>
        Px scale
        <input
          type="number"
          step="0.01"
          value={settings.pxScale}
          style={numberInput}
          onChange={(e) => onChange({ ...settings, pxScale: Number(e.target.value) || 1 })}
        />
      </label>
      <label style={fieldRow}>
        Min speed
        <input
          type="number"
          value={settings.minSpeed}
          style={numberInput}
          onChange={(e) => onChange({ ...settings, minSpeed: Number(e.target.value) || 0 })}
        />
      </label>
      <label style={fieldRow}>
        Max ROI%
        <input
          type="number"
          value={settings.roiFilterPct}
          style={numberInput}
          onChange={(e) => onChange({ ...settings, roiFilterPct: Number(e.target.value) || 0 })}
        />
      </label>
      <label style={fieldRow}>
        Pol angle
        <input
          type="number"
          value={settings.polAngle}
          style={numberInput}
          onChange={(e) => onChange({ ...settings, polAngle: Number(e.target.value) || 0 })}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.showPolLine}
          onChange={(e) => onChange({ ...settings, showPolLine: e.target.checked })}
        />
        Show pol line
      </label>
      <label style={fieldRow}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.timeCutSec != null}
            onChange={(e) => onChange({ ...settings, timeCutSec: e.target.checked ? 0 : null })}
          />
          Time cut (s)
        </span>
        <input
          type="number"
          disabled={settings.timeCutSec == null}
          value={settings.timeCutSec ?? 0}
          style={numberInput}
          onChange={(e) => onChange({ ...settings, timeCutSec: Number(e.target.value) || 0 })}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.lockSpeedAxis}
          onChange={(e) => onChange({ ...settings, lockSpeedAxis: e.target.checked })}
        />
        Lock speed axis
      </label>
      <label style={fieldRow}>
        Speed pctile
        <input
          type="number"
          min={1}
          max={100}
          disabled={!settings.lockSpeedAxis}
          value={settings.speedPercentile}
          style={numberInput}
          onChange={(e) => onChange({ ...settings, speedPercentile: Number(e.target.value) || 95 })}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.lockHistAxis}
          onChange={(e) => onChange({ ...settings, lockHistAxis: e.target.checked })}
        />
        Lock hist Y axis
      </label>
      <label style={fieldRow}>
        Color
        <select
          value={settings.colorMode}
          onChange={(e) => onChange({ ...settings, colorMode: e.target.value as Settings["colorMode"] })}
        >
          <option value="time">time</option>
          <option value="speed">speed</option>
        </select>
      </label>
    </section>
  );
}
