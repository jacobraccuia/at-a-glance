import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Bucket, Stats, Task, TaskOccurrence, TaskStatus, TodayViewResponse } from "../api/types";
import { TaskRow } from "./TaskRow";
import { OccurrenceRow } from "./OccurrenceRow";
import { QuickCapture } from "./QuickCapture";
import { TaskDetailsFields, emptyTaskDetails, type TaskDetailsValue } from "./TaskDetailsFields";
import { RecurrenceFields, emptyRecurrence, type RecurrenceValue } from "./RecurrenceFields";

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
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [newDetails, setNewDetails] = useState<TaskDetailsValue>(emptyTaskDetails);
  const [newRecurrence, setNewRecurrence] = useState<RecurrenceValue>(emptyRecurrence);
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

    const extras = view === "today" ? [api.get<Stats>("/stats")] : [];

    Promise.all([tasksReq, ...extras])
      .then(([body, maybeStats]) => {
        if (view === "today" || view === "upcoming") {
          const tv = body as TodayViewResponse;
          setTasks(tv.tasks);
          setOccurrences(tv.occurrences);
        } else {
          setTasks(body as Task[]);
          setOccurrences([]);
        }
        setStats((maybeStats as Stats | undefined) ?? null);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [view, search, statusFilter, bucketFilter]);

  useEffect(load, [load]);
  useEffect(() => {
    api.get<Bucket[]>("/buckets").then(setBuckets).catch(() => undefined);
  }, []);

  async function createTask(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      setError(null);
      await api.post("/tasks", {
        title: newTitle.trim(),
        status: "active",
        bucketId: newDetails.bucketId || undefined,
        importance: newDetails.importance,
        hardDeadline: newDetails.deadline ? new Date(newDetails.deadline).toISOString() : undefined,
        deadlineSource: newDetails.deadline ? "explicit" : undefined,
        estimateMinutes: newDetails.estimateMinutes ? parseInt(newDetails.estimateMinutes, 10) : undefined,
        waitingOn: newDetails.waitingOn || undefined,
        notes: newDetails.notes || undefined,
        attentionDate: view === "today" ? new Date().toISOString() : undefined,
        recurrence: newRecurrence.enabled
          ? {
              frequency: newRecurrence.frequency,
              interval: newRecurrence.interval ? parseInt(newRecurrence.interval, 10) : 1,
              byWeekday: newRecurrence.frequency === "weekly" ? newRecurrence.byWeekday : undefined,
              byMonthday:
                newRecurrence.frequency === "monthly" && newRecurrence.byMonthday
                  ? parseInt(newRecurrence.byMonthday, 10)
                  : undefined,
              startDate: new Date().toISOString().slice(0, 10),
            }
          : undefined,
      });
      setNewTitle("");
      setNewDetails(emptyTaskDetails);
      setNewRecurrence(emptyRecurrence);
      setShowMoreDetails(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    }
  }

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
      {view === "today" && (
        <p className="orientation">
          {pending.length + pendingOccurrences.filter((o) => o.status === "pending").length === 0
            ? "Nothing urgent today. Breathing room."
            : `${pending.length + pendingOccurrences.filter((o) => o.status === "pending").length} to look at today.`}
        </p>
      )}
      {view === "today" && stats && (
        <p className="progress-summary muted">
          {stats.completedThisWeek} completed this week · {stats.activeBacklog} active in Later
        </p>
      )}

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

      {view === "today" && <QuickCapture onCaptured={load} addToToday />}

      <form onSubmit={createTask} className="inline-create-form-wrapper">
        <div className="inline-create-form">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New task title" />
          <button type="submit">{view === "today" ? "Add to Today" : "Add"}</button>
        </div>
        <button type="button" className="details-toggle" onClick={() => setShowMoreDetails((s) => !s)}>
          {showMoreDetails ? "− Hide details" : "+ Details"}
        </button>
        {showMoreDetails && (
          <div className="create-details-panel">
            <TaskDetailsFields value={newDetails} onChange={setNewDetails} buckets={buckets} />
            <RecurrenceFields value={newRecurrence} onChange={setNewRecurrence} />
          </div>
        )}
      </form>

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
