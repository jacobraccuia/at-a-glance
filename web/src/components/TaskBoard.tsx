import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Bucket, Task, TaskOccurrence, TaskStatus, TodayViewResponse } from "../api/types";
import { TaskRow } from "./TaskRow";
import { OccurrenceRow } from "./OccurrenceRow";
import { QuickCapture } from "./QuickCapture";

export type BoardView = "today" | "upcoming" | "later" | "all";

interface Props {
  /** Initial view — page can lock one, or user can switch. */
  initialView?: BoardView;
  title?: string;
  /** Open this task's details immediately (home easy-win). */
  focusTaskId?: string | null;
}

const VIEW_OPTIONS: { id: BoardView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "later", label: "Later" },
  { id: "all", label: "All" },
];

export function TaskBoard({ initialView = "all", title, focusTaskId }: Props) {
  const [view, setView] = useState<BoardView>(initialView);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrence[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ view });
    if (search) params.set("search", search);
    if (view === "all" && statusFilter) params.set("status", statusFilter);
    if (bucketFilter) params.set("bucketId", bucketFilter);

    const tasksReq =
      view === "today" || view === "upcoming"
        ? api.get<TodayViewResponse>(`/tasks?${params.toString()}`)
        : api.get<Task[]>(`/tasks?${params.toString()}`);

    tasksReq
      .then((body) => {
        if (view === "today" || view === "upcoming") {
          const tv = body as TodayViewResponse;
          setTasks(tv.tasks);
          setOccurrences(tv.occurrences);
        } else {
          setTasks(body as Task[]);
          setOccurrences([]);
        }
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [view, search, statusFilter, bucketFilter]);

  useEffect(load, [load]);
  useEffect(() => {
    api.get<Bucket[]>("/buckets").then(setBuckets).catch(() => undefined);
  }, []);

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
    await api.patch(`/tasks/${t.id}`, { attentionDate: new Date().toISOString(), status: "active" });
    load();
  }

  const pending = view === "today" ? tasks.filter((t) => t.status === "active") : tasks;
  const completed = view === "today" ? tasks.filter((t) => t.status === "completed") : [];
  const pendingOccurrences = occurrences.filter((o) => o.status === "pending" || view !== "today");
  const completedOccurrences = view === "today" ? occurrences.filter((o) => o.status === "completed") : [];

  const heading =
    title ??
    (view === "today" ? "Today" : view === "upcoming" ? "Upcoming" : view === "later" ? "Later" : "All tasks");

  return (
    <div className="page task-board">
      <h1>{heading}</h1>
      <div className="view-filters" role="tablist" aria-label="Task view">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={view === opt.id}
            className={`view-chip${view === opt.id ? " active" : ""}`}
            onClick={() => setView(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <QuickCapture onCaptured={load} addToToday />

      <div className="filters">
        <input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {view === "all" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}>
            <option value="">Open</option>
            <option value="captured">Captured</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="dropped">Dropped</option>
          </select>
        )}
        <select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)}>
          <option value="">All buckets</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && tasks.length === 0 && <p className="muted">Loading…</p>}

      <ul className="task-list">
        {pending.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onComplete={() => completeTask(t)}
            onUndo={() => undoTask(t)}
            onSnooze={(days) => snoozeByDays(t, days)}
            onDrop={() => dropTask(t)}
            onRename={(title) => renameTask(t, title)}
            onAddToToday={view === "today" ? undefined : () => addToToday(t)}
            buckets={buckets}
            onDetailsSaved={load}
            startDetailsOpen={focusTaskId === t.id}
          />
        ))}
        {(view === "today" ? pendingOccurrences.filter((o) => o.status === "pending") : pendingOccurrences).map((o) => (
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
      {!loading && pending.length === 0 && occurrences.length === 0 && <p className="muted">Nothing here.</p>}

      {view === "today" && (completed.length > 0 || completedOccurrences.length > 0) && (
        <details className="completed-section">
          <summary>{completed.length + completedOccurrences.length} done</summary>
          <ul className="task-list">
            {completed.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onComplete={() => completeTask(t)}
                onUndo={() => undoTask(t)}
                onSnooze={(days) => snoozeByDays(t, days)}
                onDrop={() => dropTask(t)}
                onRename={(title) => renameTask(t, title)}
                buckets={buckets}
                onDetailsSaved={load}
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
