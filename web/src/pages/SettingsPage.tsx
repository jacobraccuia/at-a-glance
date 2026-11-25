import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { PersonalityMark } from "../components/icons";
import { PalettePicker } from "../components/PalettePicker";
import { useAuth } from "../auth/AuthContext";
import { BucketsPage } from "./BucketsPage";
import { readHome, saveHome, type HomeChoice } from "../home";

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
  const [focus, setFocus] = useState("task");
  const [personalityError, setPersonalityError] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [home, setHome] = useState<HomeChoice>(readHome);

  useEffect(() => {
    api.get<Personality[]>("/assistant/personalities").then(setPersonalities).catch(() => undefined);
    api.get<MemoryRow[]>("/assistant/memory").then(setMemories).catch(() => undefined);
    api.get<{ personalityId?: string; assistantFocus?: string }>("/auth/me").then((me) => {
      if (me.personalityId) setPersonalityId(me.personalityId);
      if (me.assistantFocus === "chat" || me.assistantFocus === "both" || me.assistantFocus === "task") {
        setFocus(me.assistantFocus);
      }
    }).catch(() => undefined);
    api.get<Usage>("/assistant/live/usage").then(setUsage).catch(() => undefined);
  }, []);

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  async function chooseFocus(next: string) {
    const previous = focus;
    setFocus(next);
    setPersonalityError(null);
    try {
      await api.patch("/assistant/focus", { focus: next });
    } catch (err) {
      setFocus(previous);
      setPersonalityError(err instanceof Error ? err.message : "Could not save that focus.");
    }
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
        <h2>Home</h2>
        <div className="focus-row" role="group" aria-label="Home list">
          {(
            [
              ["all", "Everything"],
              ["today", "Today"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={home === id ? "on" : ""}
              aria-pressed={home === id}
              onClick={() => {
                setHome(id);
                saveHome(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted small">Everything opens on Today, Tomorrow, Upcoming, and Later.</p>
      </section>
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
              <PersonalityMark name={personality.name} />
              <span className="personality-copy">
                <strong>{personality.name}</strong>
                <span>{personality.description}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="focus-row" role="group" aria-label="How much chat">
          {(
            [
              ["task", "Tasks"],
              ["both", "Both"],
              ["chat", "Chat"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={focus === id ? "on" : ""} aria-pressed={focus === id} onClick={() => chooseFocus(id)}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted small">Tasks keeps her on the list. Chat lets her talk more. She stays an assistant, not a therapist.</p>
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
