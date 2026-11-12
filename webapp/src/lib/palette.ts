// Qualitative palette with enough distinct hues for up to ~12 simultaneously
// tracked individuals. (The MATLAB app's first attempt used lines(), which
// only has 7 unique colors and silently repeats past that - don't redo that
// mistake here.) The first 8 are a validated colorblind-safe categorical set
// (ordered for adjacent-pair CVD safety); 9-12 extend it for files with more
// tracks, picked to stay visually distinct from their nearest same-family hue.
const BASE12 = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
  "#e87ba4", "#008300", "#6250d6", "#e34948",
  "#8b5e34", "#607d8b", "#c71585", "#556b2f",
];

// Okabe-Ito (2008) - the standard reference colorblind-safe palette, used
// when "Colorblind mode" is on instead of BASE12. The first 8 are the
// canonical set; 9-12 extend it the same way BASE12 does.
const COLORBLIND12 = [
  "#E69F00", "#56B4E9", "#009E73", "#F0E442",
  "#0072B2", "#D55E00", "#CC79A7", "#000000",
  "#999999", "#44AA99", "#882255", "#117733",
];

export function colorForIndex(i: number, colorBlind = false): string {
  const palette = colorBlind ? COLORBLIND12 : BASE12;
  return palette[i % palette.length];
}
