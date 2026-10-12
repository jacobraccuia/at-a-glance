import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Bucket, Task, TaskStatus } from "../api/types";
import { TaskRow } from "../components/TaskRow";

export function AllTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBucketId, setNewBucketId] = useState("");
  const [newAddToToday, setNewAddToToday] = useState(false);
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
    await api.post("/tasks", {
      title: newTitle.trim(),
      status: "active",
      bucketId: newBucketId || undefined,
      attentionDate: newAddToToday ? new Date().toISOString() : undefined,
    });
    setNewTitle("");
    setNewAddToToday(false);
    load();
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

      <form onSubmit={createTask} className="inline-create-form">
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New task title" />
        <select value={newBucketId} onChange={(e) => setNewBucketId(e.target.value)}>
          <option value="">No bucket</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <label className="checkbox-label">
          <input type="checkbox" checked={newAddToToday} onChange={(e) => setNewAddToToday(e.target.checked)} />
          Add to Today
        </label>
        <button type="submit">Add</button>
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
          />
        ))}
      </ul>
      {tasks.length === 0 && <p className="muted">No tasks match.</p>}
    </div>
  );
}
