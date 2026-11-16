// The sales demos: one folder per piece under projects/, holding a room-placement project (project.json)
// and a brochure-scan project (scan.json) with its scan image (assets/target.png). demos.html lists them,
// brochure.html prints one, and ar.html links a scan to its room placement.

export interface Demo {
  readonly id: string;
  readonly title: string;
  /** One line for the brochure and the index. */
  readonly pitch: string;
  /** Where room placement puts it, in plain words. */
  readonly placeHint: string;
  readonly folder: string;
}

export const DEMOS: readonly Demo[] = [
  { id: 'showpiece', title: 'Seahorn ceramic jar', pitch: 'See the piece on this page, then place it in your home at real size.', placeHint: 'On a table or the floor, 37 cm tall', folder: 'projects/seahorn' },
  { id: 'wall-art', title: 'Framed wall art', pitch: 'See the artwork on this page, then hang it on your own wall at real size.', placeHint: 'On a wall, 62 × 82 cm', folder: 'projects/wall-art' },
  { id: 'floorplan', title: 'Apartment floor plan', pitch: 'The floor plan rises off this page in 3D; walk through it at full size in your room.', placeHint: 'On open floor, about 3.5 × 3.7 m', folder: 'projects/floorplan' },
];

export const demoById = (id: string | null): Demo | undefined => DEMOS.find((demo) => demo.id === id);

/** Page links for a demo, relative to the site root (the pages all live there). */
export function demoLinks(demo: Demo): { scan: string; room: string; brochure: string; target: string } {
  return {
    scan: `ar.html?project=${encodeURIComponent(`${demo.folder}/scan.json`)}`,
    room: `webxr.html?project=${encodeURIComponent(`${demo.folder}/project.json`)}`,
    brochure: `brochure.html?demo=${encodeURIComponent(demo.id)}`,
    target: `${demo.folder}/assets/target.png`,
  };
}

/** For a brochure-scan project path (…/scan.json), its room-placement project beside it; otherwise null. */
export function roomProjectFor(projectPath: string | null): string | null {
  if (!projectPath) return null;
  const [path] = projectPath.split(/[?#]/);
  return /(^|\/)scan\.json$/.test(path) ? path.replace(/scan\.json$/, 'project.json') : null;
}
