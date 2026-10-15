const SPOT_KEY = "taskr.bucket";

export function readBucketSpot(): string {
  try {
    return localStorage.getItem(SPOT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveBucketSpot(id: string): void {
  try {
    if (!id) localStorage.removeItem(SPOT_KEY);
    else localStorage.setItem(SPOT_KEY, id);
  } catch {
    /* private mode */
  }
}

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const raw = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

function mix(a: RGB, b: RGB, towardB: number): string {
  const t = towardB;
  const c = a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function readable(rgb: RGB): string {
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum > 0.62) return mix(rgb, [30, 30, 36], 0.45);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

const TINT_KEYS = ["--accent", "--accent-soft", "--bg-top", "--bg", "--bg-glow"] as const;

/** Bucket color washes the screen. All clears it and the time-of-day palette shows. */
export function applyBucketTint(hex: string | null | undefined): void {
  const root = document.documentElement;
  if (!hex) {
    for (const key of TINT_KEYS) root.style.removeProperty(key);
    return;
  }
  const rgb = parseHex(hex);
  if (!rgb) {
    for (const key of TINT_KEYS) root.style.removeProperty(key);
    return;
  }
  root.style.setProperty("--accent", readable(rgb));
  root.style.setProperty("--accent-soft", mix(rgb, [255, 255, 255], 0.82));
  root.style.setProperty("--bg-top", mix(rgb, [255, 255, 255], 0.5));
  root.style.setProperty("--bg", mix(rgb, [247, 247, 248], 0.88));
  root.style.setProperty("--bg-glow", `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`);
}
