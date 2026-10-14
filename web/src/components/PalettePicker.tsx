import { useEffect, useState } from "react";
import {
  PALETTES,
  applyPalette,
  readPaletteChoice,
  resolvePalette,
  savePaletteChoice,
  type PaletteChoice,
  type PaletteId,
} from "../theme/palette";

export function PalettePicker() {
  const [choice, setChoice] = useState<PaletteChoice>(() => readPaletteChoice());
  const [active, setActive] = useState<PaletteId>(() => resolvePalette(readPaletteChoice()));

  useEffect(() => {
    setActive(applyPalette(choice));
    if (choice !== "auto") return;
    const tick = window.setInterval(() => setActive(applyPalette("auto")), 60_000);
    return () => window.clearInterval(tick);
  }, [choice]);

  function pick(next: PaletteChoice) {
    setChoice(next);
    setActive(savePaletteChoice(next));
  }

  return (
    <section className="palette-picker" aria-label="Background">
      <div className="palette-picker-head">
        <h2 className="settings-subhead">Background</h2>
        <span className="muted small">{choice === "auto" ? `Auto · ${labelFor(active)}` : "Pinned"}</span>
      </div>
      <div className="palette-row">
        <button
          type="button"
          className={`palette-swatch auto${choice === "auto" ? " selected" : ""}`}
          onClick={() => pick("auto")}
          aria-pressed={choice === "auto"}
        >
          <span className="palette-swatch-sky auto-sky" aria-hidden />
          <span>Auto</span>
        </button>
        {PALETTES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`palette-swatch${choice === p.id ? " selected" : ""}`}
            onClick={() => pick(p.id)}
            aria-pressed={choice === p.id}
          >
            <span className={`palette-swatch-sky sky-${p.id}`} aria-hidden />
            <span>{p.label}</span>
            <span className="muted small">{p.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function labelFor(id: PaletteId): string {
  return PALETTES.find((p) => p.id === id)?.label ?? id;
}
