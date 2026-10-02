/** Permanent presentation coordinates. Distance, height and adjacency have no Core effect. */
export interface WorldMapLocation {
  readonly landId: number;
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
  readonly visualRegion: 'crown' | 'highlands' | 'north' | 'east' | 'southeast' | 'southwest' | 'west';
}

export const WORLD_MAP_VIEWBOX = { width: 1160, height: 700 } as const;

/** Coordinates are deliberately explicit: no randomness, account-dependent layout or reordering. */
export const WORLD_MAP_LAYOUT: readonly WorldMapLocation[] = [
  { landId: 1, x: 585, y: 375, elevation: 76, visualRegion: 'crown' },
  { landId: 2, x: 585, y: 265, elevation: 40, visualRegion: 'highlands' },
  { landId: 3, x: 722, y: 330, elevation: 40, visualRegion: 'highlands' },
  { landId: 4, x: 668, y: 457, elevation: 40, visualRegion: 'highlands' },
  { landId: 5, x: 482, y: 469, elevation: 40, visualRegion: 'highlands' },
  { landId: 6, x: 449, y: 339, elevation: 40, visualRegion: 'highlands' },
  { landId: 7, x: 580, y: 113, elevation: 14, visualRegion: 'north' },
  { landId: 8, x: 526, y: 144, elevation: 14, visualRegion: 'north' },
  { landId: 9, x: 634, y: 144, elevation: 14, visualRegion: 'north' },
  { landId: 10, x: 472, y: 175, elevation: 14, visualRegion: 'north' },
  { landId: 11, x: 580, y: 175, elevation: 14, visualRegion: 'north' },
  { landId: 12, x: 688, y: 175, elevation: 14, visualRegion: 'north' },
  { landId: 13, x: 526, y: 206, elevation: 14, visualRegion: 'north' },
  { landId: 14, x: 634, y: 206, elevation: 14, visualRegion: 'north' },
  { landId: 15, x: 688, y: 237, elevation: 14, visualRegion: 'north' },
  { landId: 16, x: 830, y: 225, elevation: 14, visualRegion: 'east' },
  { landId: 17, x: 884, y: 256, elevation: 14, visualRegion: 'east' },
  { landId: 18, x: 938, y: 287, elevation: 14, visualRegion: 'east' },
  { landId: 19, x: 776, y: 256, elevation: 14, visualRegion: 'east' },
  { landId: 20, x: 830, y: 287, elevation: 14, visualRegion: 'east' },
  { landId: 21, x: 884, y: 318, elevation: 14, visualRegion: 'east' },
  { landId: 22, x: 776, y: 318, elevation: 14, visualRegion: 'east' },
  { landId: 23, x: 830, y: 349, elevation: 14, visualRegion: 'east' },
  { landId: 24, x: 884, y: 380, elevation: 14, visualRegion: 'east' },
  { landId: 25, x: 829, y: 444, elevation: 14, visualRegion: 'southeast' },
  { landId: 26, x: 883, y: 475, elevation: 14, visualRegion: 'southeast' },
  { landId: 27, x: 775, y: 475, elevation: 14, visualRegion: 'southeast' },
  { landId: 28, x: 829, y: 506, elevation: 14, visualRegion: 'southeast' },
  { landId: 29, x: 721, y: 506, elevation: 14, visualRegion: 'southeast' },
  { landId: 30, x: 775, y: 537, elevation: 14, visualRegion: 'southeast' },
  { landId: 31, x: 829, y: 568, elevation: 14, visualRegion: 'southeast' },
  { landId: 32, x: 667, y: 537, elevation: 14, visualRegion: 'southeast' },
  { landId: 33, x: 721, y: 568, elevation: 14, visualRegion: 'southeast' },
  { landId: 34, x: 535, y: 569, elevation: 14, visualRegion: 'southwest' },
  { landId: 35, x: 481, y: 538, elevation: 14, visualRegion: 'southwest' },
  { landId: 36, x: 427, y: 507, elevation: 14, visualRegion: 'southwest' },
  { landId: 37, x: 373, y: 476, elevation: 14, visualRegion: 'southwest' },
  { landId: 38, x: 319, y: 507, elevation: 14, visualRegion: 'southwest' },
  { landId: 39, x: 373, y: 538, elevation: 14, visualRegion: 'southwest' },
  { landId: 40, x: 427, y: 569, elevation: 14, visualRegion: 'southwest' },
  { landId: 41, x: 319, y: 569, elevation: 14, visualRegion: 'southwest' },
  { landId: 42, x: 373, y: 600, elevation: 14, visualRegion: 'southwest' },
  { landId: 43, x: 272, y: 237, elevation: 14, visualRegion: 'west' },
  { landId: 44, x: 326, y: 268, elevation: 14, visualRegion: 'west' },
  { landId: 45, x: 218, y: 268, elevation: 14, visualRegion: 'west' },
  { landId: 46, x: 272, y: 299, elevation: 14, visualRegion: 'west' },
  { landId: 47, x: 326, y: 330, elevation: 14, visualRegion: 'west' },
  { landId: 48, x: 218, y: 330, elevation: 14, visualRegion: 'west' },
  { landId: 49, x: 272, y: 361, elevation: 14, visualRegion: 'west' },
  { landId: 50, x: 326, y: 392, elevation: 14, visualRegion: 'west' },
];
