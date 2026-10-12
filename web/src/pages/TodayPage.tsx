import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Stats, Task, TodayViewResponse } from "../api/types";
import { TaskRow } from "../components/TaskRow";
import { OccurrenceRow } from "../components/OccurrenceRow";
import { QuickCapture } from "../components/QuickCapture";

export function TodayPage() {
  const [data, setData] = useState<TodayViewResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get<TodayViewResponse>("/tasks?view=today"), api.get<Stats>("/stats")])
      .then(([tv, s]) => {
        setData(tv);
        setStats(s);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function completeTask(t: Task) {
    await api.post(`/tasks/${t.id}/complete`);
    load();
  }
  async function undoTask(t: Task) {
    await api.post(`/tasks/${t.id}/undo`);
    load();
  }
  async function snoozeTomorrow(t: Task) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await api.post(`/tasks/${t.id}/snooze`, { until: tomorrow.toISOString() });
    load();
  }
  async function dropTask(t: Task) {
    await api.post(`/tasks/${t.id}/drop`);
    load();
  }
  async function renameTask(t: Task, title: string) {
    await api.patch(`/tasks/${t.id}`, { title });
    load();
  }

  if (loading && !data) return <p className="muted">Loading...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;

  const pending = data.tasks.filter((t) => t.status === "active");
  const completed = data.tasks.filter((t) => t.status === "completed");
  const pendingOccurrences = data.occurrences.filter((o) => o.status === "pending");
  const completedOccurrences = data.occurrences.filter((o) => o.status === "completed");

  return (
    <div className="page today-page">
      <h1>Today</h1>
      <p className="orientation">
        {pending.length + pendingOccurrences.length === 0
          ? "Nothing urgent today. Breathing room."
          : `${pending.length + pendingOccurrences.length} thing${pending.length + pendingOccurrences.length === 1 ? "" : "s"} to look at today.`}
      </p>

      {stats && (
        <p className="progress-summary muted">
          {stats.completedThisWeek} completed this week &middot; {stats.activeBacklog} active in backlog
        </p>
      )}

      <QuickCapture onCaptured={load} addToToday />

      <ul className="task-list">
        {pending.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onComplete={() => completeTask(t)}
            onUndo={() => undoTask(t)}
            onSnoozeTomorrow={() => snoozeTomorrow(t)}
            onDrop={() => dropTask(t)}
            onRename={(title) => renameTask(t, title)}
          />
        ))}
        {pendingOccurrences.map((o) => (
          <OccurrenceRow
            key={o.id}
            occurrence={o}
            onComplete={async () => {
              await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
              load();
            }}
            onUndo={async () => {
              await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
              load();
            }}
          />
        ))}
      </ul>

      {(completed.length > 0 || completedOccurrences.length > 0) && (
        <details className="completed-section">
          <summary>{completed.length + completedOccurrences.length} done</summary>
          <ul className="task-list">
            {completed.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onComplete={() => completeTask(t)}
                onUndo={() => undoTask(t)}
                onSnoozeTomorrow={() => snoozeTomorrow(t)}
                onDrop={() => dropTask(t)}
                onRename={(title) => renameTask(t, title)}
              />
            ))}
            {completedOccurrences.map((o) => (
              <OccurrenceRow
                key={o.id}
                occurrence={o}
                onComplete={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
                  load();
                }}
                onUndo={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
                  load();
                }}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
