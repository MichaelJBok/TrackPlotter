import Plotly from "plotly.js-dist-min";
import type { Layout, Config } from "plotly.js-dist-min";
import jsPDF from "jspdf";

function filenameFromTitle(gd: Readonly<{ _fullLayout: { title?: { text?: string } } }>): string {
  const raw = gd._fullLayout.title?.text ?? "plot";
  // Titles can carry a `<br><span ...>` subtitle - strip any markup, then any
  // character that isn't filesystem-safe.
  return raw.replace(/<[^>]*>/g, " ").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "plot";
}

async function downloadPlotAsPdf(gd: any): Promise<void> {
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

const downloadPdfButton = {
  name: "downloadPdf",
  title: "Download plot as a PDF",
  icon: Plotly.Icons.disk,
  click: (gd: any) => {
    downloadPlotAsPdf(gd).catch((err) => console.error("PDF export failed:", err));
  },
};

export const basePlotConfig: Partial<Config> = {
  // Modebar hidden until hover, showing only the PNG/PDF export icons -
  // every panel is individually exportable as a figure without cluttering
  // the view with the rest of Plotly's default toolbar.
  displayModeBar: "hover",
  modeBarButtons: [["toImage", downloadPdfButton]],
  displaylogo: false,
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
