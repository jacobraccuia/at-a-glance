import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type TalkMode = "off" | "live" | "quick";

interface VoiceSessionContextValue {
  mode: TalkMode;
  open: boolean;
  openSession: () => void;
  openQuick: () => void;
  closeSession: () => void;
  toggleSession: () => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<TalkMode>("off");
  const openSession = useCallback(() => setMode("live"), []);
  const openQuick = useCallback(() => setMode("quick"), []);
  const closeSession = useCallback(() => setMode("off"), []);
  const toggleSession = useCallback(() => setMode((current) => (current === "off" ? "live" : "off")), []);
  const value = useMemo(
    () => ({ mode, open: mode !== "off", openSession, openQuick, closeSession, toggleSession }),
    [mode, openSession, openQuick, closeSession, toggleSession],
  );
  return <VoiceSessionContext.Provider value={value}>{children}</VoiceSessionContext.Provider>;
}

export function useVoiceSession() {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) throw new Error("useVoiceSession must be used inside VoiceSessionProvider");
  return ctx;
}
