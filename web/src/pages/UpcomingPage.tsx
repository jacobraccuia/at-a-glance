import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Bucket, Task, TodayViewResponse } from "../api/types";
import { TaskRow } from "../components/TaskRow";
import { OccurrenceRow } from "../components/OccurrenceRow";

export function UpcomingPage() {
  const [data, setData] = useState<TodayViewResponse | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
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
  useEffect(() => {
    api.get<Bucket[]>("/buckets").then(setBuckets);
  }, []);

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
  async function snoozeByDays(t: Task, days: number) {
    const until = new Date();
    until.setDate(until.getDate() + days);
    await api.post(`/tasks/${t.id}/snooze`, { until: until.toISOString() });
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
  async function addToToday(t: Task) {
    await api.patch(`/tasks/${t.id}`, { attentionDate: new Date().toISOString() });
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
            onSnooze={(days) => snoozeByDays(t, days)}
            onDrop={() => dropTask(t)}
            onRename={(title) => renameTask(t, title)}
            onAddToToday={() => addToToday(t)}
            buckets={buckets}
            onDetailsSaved={load}
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
