import type { Platform } from "./types.js";

const EXTENSION_MAP: Record<string, Platform> = {
  ".swift": "ios",
  ".kt": "android",
  ".kts": "android",
  ".go": "golang",
  ".tsx": "react",
  ".ts": "react",
  ".jsx": "react",
};

export function detectPlatform(files: string[]): Platform | null {
  const counts: Partial<Record<Platform, number>> = {};

  for (const file of files) {
    const ext = file.slice(file.lastIndexOf("."));
    const platform = EXTENSION_MAP[ext];
    if (platform) {
      counts[platform] = (counts[platform] ?? 0) + 1;
    }
  }

  let best: Platform | null = null;
  let bestCount = 0;

  for (const [platform, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = platform as Platform;
      bestCount = count;
    }
  }

  return best;
}
