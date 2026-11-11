// Qualitative palette with enough distinct hues for up to ~12 simultaneously
// tracked individuals. (The MATLAB app's first attempt used lines(), which
// only has 7 unique colors and silently repeats past that - don't redo that
// mistake here.)
const BASE12 = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
  "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
  "#bcbd22", "#17becf", "#aec7e8", "#ffbb78",
];

export function colorForIndex(i: number): string {
  return BASE12[i % BASE12.length];
}
