import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { PalettePicker } from "../components/PalettePicker";
import { useAuth } from "../auth/AuthContext";
import { BucketsPage } from "./BucketsPage";

interface Personality {
  id: string;
  name: string;
  description: string;
}

interface MemoryRow {
  id: string;
  kind: string;
  text: string;
  source: string;
}

interface Usage {
  estimatedUsd: number;
  budgetUsd: number;
  warning: boolean;
}

/** Account: look, assistant, memory, buckets, and sign-out. */
export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [personalityId, setPersonalityId] = useState("puck");
  const [personalityError, setPersonalityError] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    api.get<Personality[]>("/assistant/personalities").then(setPersonalities).catch(() => undefined);
    api.get<MemoryRow[]>("/assistant/memory").then(setMemories).catch(() => undefined);
    api.get<{ personalityId?: string }>("/auth/me").then((me) => {
      if (me.personalityId) setPersonalityId(me.personalityId);
    }).catch(() => undefined);
    api.get<Usage>("/assistant/live/usage").then(setUsage).catch(() => undefined);
  }, []);

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  async function choosePersonality(id: string) {
    const previous = personalityId;
    setPersonalityId(id);
    setPersonalityError(null);
    try {
      await api.patch("/assistant/personality", { id });
    } catch (err) {
      setPersonalityId(previous);
      setPersonalityError(err instanceof Error ? err.message : "Could not save that personality.");
    }
  }

  async function removeMemory(id: string) {
    await api.delete(`/assistant/memory/${id}`);
    setMemories((rows) => rows.filter((row) => row.id !== id));
  }

  async function clearMemory() {
    await api.delete("/assistant/memory");
    setMemories([]);
  }

  return (
    <div className="page settings-page">
      <p className="brand-mark">{branding.appName}</p>
      <h1>Account</h1>
      <p className="muted small account-who">{user?.isGuest ? "Guest" : user?.displayName}</p>
      <PalettePicker />
      <section className="account-block">
        <h2>Assistant</h2>
        <div className="personality-row">
          {personalities.map((personality) => (
            <button
              key={personality.id}
              type="button"
              className={personality.id === personalityId ? "personality on" : "personality"}
              aria-pressed={personality.id === personalityId}
              onClick={() => choosePersonality(personality.id)}
            >
              <strong>{personality.name}</strong>
              <span>{personality.description}</span>
            </button>
          ))}
        </div>
        <p className="muted small">
          {personalities.find((personality) => personality.id === personalityId)?.name ?? "Puck"} on the next call.
          Voice changes when Talk reconnects.
        </p>
        {personalityError && <p className="muted small">{personalityError}</p>}
        {usage && (
          <p className="muted small">
            Voice this month: ${usage.estimatedUsd.toFixed(2)} of ${usage.budgetUsd.toFixed(0)}
            {usage.warning ? " — over the soft budget." : "."}
          </p>
        )}
      </section>
      <section className="account-block">
        <h2>Memory</h2>
        {memories.length === 0 && <p className="muted small">Nothing saved yet.</p>}
        <ul className="memory-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <span>
                {memory.text} <em>({memory.source})</em>
              </span>
              <button type="button" onClick={() => removeMemory(memory.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        {memories.length > 0 && (
          <button type="button" onClick={clearMemory}>
            Delete all memory
          </button>
        )}
      </section>
      <BucketsPage />
      <button type="button" className="account-logout" onClick={onLogout}>
        {user?.isGuest ? "End guest" : "Log out"}
      </button>
    </div>
  );
}
