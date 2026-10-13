import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface VoiceSessionContextValue {
  open: boolean;
  openSession: () => void;
  closeSession: () => void;
  toggleSession: () => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSession = useCallback(() => setOpen(true), []);
  const closeSession = useCallback(() => setOpen(false), []);
  const toggleSession = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo(
    () => ({ open, openSession, closeSession, toggleSession }),
    [open, openSession, closeSession, toggleSession],
  );
  return <VoiceSessionContext.Provider value={value}>{children}</VoiceSessionContext.Provider>;
}

export function useVoiceSession() {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) throw new Error("useVoiceSession must be used inside VoiceSessionProvider");
  return ctx;
}
