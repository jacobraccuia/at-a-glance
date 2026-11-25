// Small shared inline icon set, same stroke style as the nav icons in
// Layout.tsx (24x24 viewBox, strokeWidth 2, round caps/joins).

export function DetailsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21v-5.5L16.5 3a2.1 2.1 0 0 1 3 3L7 18.5 2 20l1-4.5L4 21" />
    </svg>
  );
}

export function LaterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h16l-1.2 11.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8L4 8Z" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
    </svg>
  );
}

export function SnoozeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </svg>
  );
}

export function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6h12Z" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h18v3H3zM5 10v9h14v-9" />
      <path d="M10 14h4" />
    </svg>
  );
}
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19.2c1.4-2.6 3.8-4 7-4s5.6 1.4 7 4" />
    </svg>
  );
}

const PERSONALITY_MARKS: Record<string, JSX.Element> = {
  puck: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3Z" />
      <path d="M18 15l.6 1.8L20.5 17.5 18.6 18.1 18 20l-.6-1.9L15.5 17.5l1.9-.7L18 15Z" />
    </svg>
  ),
  atlas: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18l5.5-8 3.5 5 2.5-3.5L21 18" />
      <path d="M3 18h18" />
    </svg>
  ),
  sage: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6c-2.2-1.6-5.2-2-8-1.4V18c2.8-.6 5.8-.2 8 1.4 2.2-1.6 5.2-2 8-1.4V4.6C17.2 4 14.2 4.4 12 6Z" />
      <path d="M12 6v13.4" />
    </svg>
  ),
  mercury: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3L6 13h6l-1 8 7-10h-6l1-8Z" />
    </svg>
  ),
  logos: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7h14M5 12h10M5 17h14" />
    </svg>
  ),
};

export function PersonalityMark({ name }: { name: string }) {
  const mark = PERSONALITY_MARKS[name.trim().toLowerCase()] ?? PERSONALITY_MARKS.puck;
  return (
    <span className="personality-mark" aria-hidden>
      {mark}
    </span>
  );
}

export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
    </svg>
  );
}
