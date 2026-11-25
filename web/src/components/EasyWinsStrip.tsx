import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Task } from "../api/types";

interface EasyWin {
  id: string;
  title: string;
  estimateMinutes: number | null;
  assumedMinutes: number;
}

const BUDGETS = [15, 30, 45];

interface Props {
  minutes: number;
  onMinutes: (minutes: number) => void;
  bucketId?: string;
  hideWork?: boolean;
  refreshToken?: number;
  hiddenIds?: string[];
  renderTask: (task: Task) => ReactNode;
}

/** Short tasks that fit the time you actually have. Checking one off clears it here. */
export function EasyWinsStrip({
  minutes,
  onMinutes,
  bucketId = "",
  hideWork = false,
  refreshToken = 0,
  hiddenIds = [],
  renderTask,
}: Props) {
  const [easyWins, setEasyWins] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ticket = useRef(0);

  const loadEasyWins = useCallback(() => {
    const mine = ++ticket.current;
    const params = new URLSearchParams({ minutes: String(minutes) });
    if (bucketId) params.set("bucketId", bucketId);
    else if (hideWork) params.set("excludeBucketName", "Work");
    api
      .get<{ minutes: number; wins: EasyWin[]; tasks?: Task[] }>(`/assistant/easy-wins?${params.toString()}`)
      .then(async (r) => {
        if (mine !== ticket.current) return;
        let rows = r.tasks ?? [];
        if (rows.length === 0 && r.wins.length > 0) {
          const fetched = await Promise.all(r.wins.map((win) => api.get<Task>(`/tasks/${win.id}`).catch(() => null)));
          rows = fetched.filter((task): task is Task => task != null);
        }
        if (mine !== ticket.current) return;
        setEasyWins(rows);
      })
      .catch(() => {
        /* non-fatal */
      })
      .finally(() => {
        if (mine === ticket.current) setLoaded(true);
      });
  }, [minutes, bucketId, hideWork]);

  useEffect(() => {
    loadEasyWins();
  }, [loadEasyWins, refreshToken]);

  const visible = easyWins.filter((w) => !hiddenIds.includes(w.id));
  if (!loaded) return null;
  if (visible.length === 0) {
    return (
      <section className="easy-wins-strip" aria-label="Easy wins">
        <div className="easy-wins-head">
          <h2>Easy wins</h2>
          <BudgetChips minutes={minutes} onMinutes={onMinutes} />
        </div>
        <p className="muted small">Nothing that fits {minutes} minutes.</p>
      </section>
    );
  }

  return (
    <section className="easy-wins-strip" aria-label="Easy wins">
      <div className="easy-wins-head">
        <h2>Easy wins</h2>
        <BudgetChips minutes={minutes} onMinutes={onMinutes} />
      </div>
      <ul className="task-list">
        {visible.map((task) => renderTask(task))}
      </ul>
    </section>
  );
}

function BudgetChips({ minutes, onMinutes }: { minutes: number; onMinutes: (minutes: number) => void }) {
  return (
    <div className="easy-win-budgets" role="group" aria-label="Time available">
      {BUDGETS.map((n) => (
        <button
          key={n}
          type="button"
          className={`view-chip${minutes === n ? " active" : ""}`}
          aria-pressed={minutes === n}
          onClick={() => onMinutes(n)}
        >
          {n}m
        </button>
      ))}
    </div>
  );
}
