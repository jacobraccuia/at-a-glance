import { useCallback, useEffect, useRef, useState } from "react";

const POOF_MS = 780;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Play the done animation, then run the real complete. */
export function useCelebrate(onDone: () => void) {
  const [poof, setPoof] = useState(false);
  const onDoneRef = useRef(onDone);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  onDoneRef.current = onDone;

  useEffect(() => {
    return () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      onDoneRef.current();
    };
  }, []);

  const celebrate = useCallback(() => {
    if (busy.current) return;
    if (prefersReducedMotion()) {
      onDoneRef.current();
      return;
    }
    busy.current = true;
    setPoof(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      onDoneRef.current();
    }, POOF_MS);
  }, []);

  return { poof, celebrate };
}
