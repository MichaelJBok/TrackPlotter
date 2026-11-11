import type { Layout, Config } from "plotly.js-dist-min";

export const basePlotConfig: Partial<Config> = {
  // Modebar hidden until hover, showing only the PNG-export ("camera") icon -
  // every panel is individually exportable as a figure without cluttering
  // the view with the rest of Plotly's default toolbar.
  displayModeBar: "hover",
  modeBarButtons: [["toImage"]],
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
