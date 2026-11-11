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

export function colorForIndex(i: number): string {
  return BASE12[i % BASE12.length];
}
