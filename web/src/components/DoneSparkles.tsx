const BITS: Array<{ x: number; y: number; delay: number; size: number; glyph: string }> = [
  { x: -40, y: -36, delay: 0, size: 20, glyph: "✦" },
  { x: 30, y: -48, delay: 40, size: 16, glyph: "✧" },
  { x: 52, y: -14, delay: 20, size: 22, glyph: "✦" },
  { x: -10, y: -56, delay: 60, size: 15, glyph: "✦" },
  { x: 58, y: -36, delay: 80, size: 14, glyph: "✧" },
  { x: -52, y: -8, delay: 30, size: 18, glyph: "✦" },
  { x: 12, y: -22, delay: 10, size: 13, glyph: "✧" },
  { x: 24, y: 16, delay: 70, size: 17, glyph: "✦" },
  { x: -24, y: 12, delay: 50, size: 12, glyph: "✧" },
  { x: 44, y: -52, delay: 90, size: 15, glyph: "✦" },
];

/** Burst that plays while a finished task fades away. */
export function DoneSparkles() {
  return (
    <span className="done-sparkles" aria-hidden>
      {BITS.map((bit, i) => (
        <span
          key={i}
          style={{
            ["--sx" as string]: `${bit.x}px`,
            ["--sy" as string]: `${bit.y}px`,
            ["--sd" as string]: `${bit.delay}ms`,
            ["--ss" as string]: `${bit.size}px`,
          }}
        >
          {bit.glyph}
        </span>
      ))}
    </span>
  );
}
