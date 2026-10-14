export const PALETTE_STORAGE_KEY = "taskr.palette";

export type PaletteId = "clear" | "warm" | "dusk";
export type PaletteChoice = "auto" | PaletteId;

export const PALETTES: { id: PaletteId; label: string; hint: string }[] = [
  { id: "clear", label: "Clear", hint: "Daylight" },
  { id: "warm", label: "Warm", hint: "Morning" },
  { id: "dusk", label: "Dusk", hint: "Evening" },
];

const THEME_COLORS: Record<PaletteId, string> = {
  clear: "#2f5bd3",
  warm: "#0e7c6b",
  dusk: "#5a46c8",
};

export function paletteForHour(hour: number): PaletteId {
  if (hour >= 5 && hour < 11) return "warm";
  if (hour >= 11 && hour < 17) return "clear";
  return "dusk";
}

export function readPaletteChoice(): PaletteChoice {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (raw === "clear" || raw === "warm" || raw === "dusk" || raw === "auto") return raw;
  } catch {
    /* private mode */
  }
  return "auto";
}

export function resolvePalette(choice: PaletteChoice, now = new Date()): PaletteId {
  if (choice === "auto") return paletteForHour(now.getHours());
  return choice;
}

export function applyPalette(choice: PaletteChoice, now = new Date()): PaletteId {
  const resolved = resolvePalette(choice, now);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[resolved]);
  return resolved;
}

export function savePaletteChoice(choice: PaletteChoice): PaletteId {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, choice);
  } catch {
    /* ignore */
  }
  return applyPalette(choice);
}
