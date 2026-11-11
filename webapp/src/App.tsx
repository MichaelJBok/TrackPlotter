import { useEffect, useMemo, useRef, useState } from "react";
import { parseTracksCsv } from "./lib/parseCsv";
import { backgroundImageTag, loadBackgroundImage } from "./lib/backgroundImage";
import {
  collectFiles,
  directoryPickerSupported,
  forgetDirectory,
  getRememberedDirectory,
  rememberDirectory,
  verifyReadPermission,
} from "./lib/directoryMemory";
import { DEFAULT_SETTINGS, type BackgroundImage, type Settings } from "./lib/types";
import OverviewView from "./components/OverviewView";
import SingleTrackView from "./components/SingleTrackView";

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
  // Name of a folder remembered from a previous session (File System Access
  // API only - see directoryMemory.ts); null until checked or if none saved.
  const [rememberedDirName, setRememberedDirName] = useState<string | null>(null);
  const [selection, setSelection] = useState<string>(OVERVIEW);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    if (!directoryPickerSupported) return;
    getRememberedDirectory().then((handle) => setRememberedDirName(handle?.name ?? null));
  }, []);

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

  /** Chrome/Edge path: a real directory handle, rememberable across
   * sessions. Falls back to the plain <input webkitdirectory> picker
   * (handleFolderUpload) on browsers without the File System Access API. */
  async function handlePickFolder() {
    if (!directoryPickerSupported) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: "read" });
      await rememberDirectory(handle);
      setRememberedDirName(handle.name);
      await loadFolderFiles(await collectFiles(handle));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFileErrors([`Couldn't read the folder: ${(err as Error).message}`]);
      }
    }
  }

  async function handleReloadRemembered() {
    const handle = await getRememberedDirectory();
    if (!handle) return;
    if (!(await verifyReadPermission(handle))) {
      setFileErrors([`Access to "${handle.name}" wasn't granted - use "Load folder…" to pick it again.`]);
      return;
    }
    await loadFolderFiles(await collectFiles(handle));
  }

  async function handleForgetFolder() {
    await forgetDirectory();
    setRememberedDirName(null);
  }

  function handleClearUploads() {
    setUploadedFiles({});
    setFileErrors([]);
    setActiveFile(null);
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
          <select
            value={activeFile ?? ""}
            onChange={(e) => handleFileChange(e.target.value)}
            disabled={uploadedNames.length === 0}
          >
            {uploadedNames.length === 0 && <option value="">— no data loaded —</option>}
            {uploadedNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
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
        <button type="button" style={{ fontSize: 12 }} onClick={handlePickFolder}>
          Load folder…
        </button>
        {directoryPickerSupported && rememberedDirName && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" style={{ fontSize: 12 }} onClick={handleReloadRemembered}>
              Reload "{rememberedDirName}"
            </button>
            <button
              type="button"
              title="Forget remembered folder"
              style={{ fontSize: 12 }}
              onClick={handleForgetFolder}
            >
              ✕
            </button>
          </span>
        )}
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
        {data && (
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
        )}
        <SettingsBar settings={settings} onChange={setSettings} />
      </header>
      {(fileErrors.length > 0 || bgErrors.length > 0) && (
        <div style={{ color: "#c0392b", fontSize: 12, marginTop: -8, marginBottom: 12 }}>
          {[...fileErrors, ...bgErrors].map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
        </div>
      )}

      {!data ? (
        <p style={{ color: "#666", fontSize: 14 }}>
          Load a tracks CSV (or a whole folder of them) above to get started. Nothing you load is ever sent
          anywhere - it's read directly off your disk and stays in this browser tab.
        </p>
      ) : selection === OVERVIEW ? (
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
