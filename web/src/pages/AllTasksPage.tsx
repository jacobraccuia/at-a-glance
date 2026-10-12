import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Bucket, Task, TaskStatus } from "../api/types";
import { TaskRow } from "../components/TaskRow";
import { TaskDetailsFields, emptyTaskDetails, type TaskDetailsValue } from "../components/TaskDetailsFields";
import { RecurrenceFields, emptyRecurrence, type RecurrenceValue } from "../components/RecurrenceFields";

export function AllTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newAddToToday, setNewAddToToday] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [newDetails, setNewDetails] = useState<TaskDetailsValue>(emptyTaskDetails);
  const [newRecurrence, setNewRecurrence] = useState<RecurrenceValue>(emptyRecurrence);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ view: "all" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bucketFilter) params.set("bucketId", bucketFilter);
    api
      .get<Task[]>(`/tasks?${params.toString()}`)
      .then((t) => {
        setTasks(t);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [search, statusFilter, bucketFilter]);

  useEffect(load, [load]);
  useEffect(() => {
    api.get<Bucket[]>("/buckets").then(setBuckets);
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
        attentionDate: newAddToToday ? new Date().toISOString() : undefined,
        recurrence: newRecurrence.enabled
          ? {
              frequency: newRecurrence.frequency,
              interval: newRecurrence.interval ? parseInt(newRecurrence.interval, 10) : 1,
              byWeekday: newRecurrence.frequency === "weekly" ? newRecurrence.byWeekday : undefined,
              byMonthday: newRecurrence.frequency === "monthly" && newRecurrence.byMonthday ? parseInt(newRecurrence.byMonthday, 10) : undefined,
              startDate: new Date().toISOString().slice(0, 10),
            }
          : undefined,
      });
      setNewTitle("");
      setNewAddToToday(false);
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
  async function addToToday(t: Task) {
    await api.patch(`/tasks/${t.id}`, { attentionDate: new Date().toISOString() });
    load();
  }

  return (
    <div className="page">
      <h1>All tasks</h1>

      <form onSubmit={createTask} className="inline-create-form-wrapper">
        <div className="inline-create-form">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New task title" />
          <label className="checkbox-label">
            <input type="checkbox" checked={newAddToToday} onChange={(e) => setNewAddToToday(e.target.checked)} />
            Add to Today
          </label>
          <button type="submit">Add</button>
        </div>
        <button type="button" className="details-toggle" onClick={() => setShowMoreDetails((s) => !s)}>
          {showMoreDetails ? "- Hide details" : "+ Add details (bucket, deadline, repeat, notes...)"}
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
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}>
          <option value="">All statuses</option>
          <option value="captured">Captured</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="dropped">Dropped</option>
        </select>
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

      <ul className="task-list">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onComplete={() => completeTask(t)}
            onUndo={() => undoTask(t)}
            onSnoozeTomorrow={() => snoozeTomorrow(t)}
            onDrop={() => dropTask(t)}
            onRename={(title) => renameTask(t, title)}
            onAddToToday={() => addToToday(t)}
            buckets={buckets}
            onDetailsSaved={load}
          />
        ))}
      </ul>
      {tasks.length === 0 && <p className="muted">No tasks match.</p>}
    </div>
  );
}
