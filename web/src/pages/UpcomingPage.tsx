import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Task, TodayViewResponse } from "../api/types";
import { TaskRow } from "../components/TaskRow";
import { OccurrenceRow } from "../components/OccurrenceRow";

export function UpcomingPage() {
  const [data, setData] = useState<TodayViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<TodayViewResponse>("/tasks?view=upcoming")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading...</p>;

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

  return (
    <div className="page">
      <h1>Upcoming (next 7 days)</h1>
      <ul className="task-list">
        {data.tasks.map((t) => (
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
        {data.occurrences.map((o) => (
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
      {data.tasks.length === 0 && data.occurrences.length === 0 && <p className="muted">Nothing on the horizon.</p>}
    </div>
  );
}
