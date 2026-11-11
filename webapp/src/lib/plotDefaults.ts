import Plotly from "plotly.js-dist-min";
import type { Layout, Config } from "plotly.js-dist-min";
import jsPDF from "jspdf";

function filenameFromTitle(gd: Readonly<{ _fullLayout: { title?: { text?: string } } }>): string {
  const raw = gd._fullLayout.title?.text ?? "plot";
  // Titles can carry a `<br><span ...>` subtitle - strip any markup, then any
  // character that isn't filesystem-safe.
  return raw.replace(/<[^>]*>/g, " ").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "plot";
}

export async function downloadPlotAsPng(gd: any): Promise<void> {
  const width = gd._fullLayout.width;
  const height = gd._fullLayout.height;
  const dataUrl = await Plotly.toImage(gd, { format: "png", width, height, scale: 2 });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${filenameFromTitle(gd)}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function downloadPlotAsPdf(gd: any): Promise<void> {
  const width = gd._fullLayout.width;
  const height = gd._fullLayout.height;
  const dataUrl = await Plotly.toImage(gd, { format: "png", width, height, scale: 1.5 });
  const pdf = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "pt",
    format: [width, height],
  });
  pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
  pdf.save(`${filenameFromTitle(gd)}.pdf`);
}

/** Exports every Plotly figure currently on screen (whatever view is active)
 * as separate files, one per figure - used by the sidebar's figure-export
 * buttons instead of each plot having its own export controls. */
export async function exportAllVisiblePlots(format: "png" | "pdf"): Promise<void> {
  const plots = Array.from(document.querySelectorAll<HTMLDivElement>(".js-plotly-plot"));
  const exportOne = format === "png" ? downloadPlotAsPng : downloadPlotAsPdf;
  for (const gd of plots) {
    await exportOne(gd);
  }
}

export const basePlotConfig: Partial<Config> = {
  // Figure export lives in the sidebar (see exportAllVisiblePlots) instead of
  // a per-plot hover toolbar.
  displayModeBar: false,
  responsive: true,
};

export function baseLayout(title: string, overrides: Partial<Layout> = {}): Partial<Layout> {
  return {
    title: { text: title, font: { size: 12 } },
    font: { size: 10, color: "#333" },
    margin: { l: 44, r: 20, t: 28, b: 36 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    showlegend: false,
    ...overrides,
  };
}

export const gridColor = "#e0e0e0";
