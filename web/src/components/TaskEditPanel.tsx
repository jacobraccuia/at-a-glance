import { useState } from "react";
import { api } from "../api/client";
import type { Bucket, Task } from "../api/types";
import { TaskDetailsFields, type TaskDetailsValue } from "./TaskDetailsFields";

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function valuesFromTask(task: Task): TaskDetailsValue {
  return {
    bucketId: task.bucketId ?? "",
    importance: task.importance,
    deadline: toDatetimeLocal(task.hardDeadline),
    estimateMinutes: task.estimateMinutes != null ? String(task.estimateMinutes) : "",
    waitingOn: task.waitingOn ?? "",
    notes: task.notes ?? "",
  };
}

interface Props {
  task: Task;
  buckets: Bucket[];
  onSaved: () => void;
  onClose: () => void;
}

export function TaskEditPanel({ task, buckets, onSaved, onClose }: Props) {
  const [values, setValues] = useState<TaskDetailsValue>(valuesFromTask(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/tasks/${task.id}`, {
        bucketId: values.bucketId || null,
        importance: values.importance,
        hardDeadline: values.deadline ? new Date(values.deadline).toISOString() : null,
        deadlineSource: values.deadline ? "explicit" : null,
        estimateMinutes: values.estimateMinutes ? parseInt(values.estimateMinutes, 10) : null,
        waitingOn: values.waitingOn || null,
        notes: values.notes || null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="task-edit-panel">
      <TaskDetailsFields value={values} onChange={setValues} buckets={buckets} />
      {task.recurrenceRuleId && (
        <p className="muted small">Recurrence can't be edited yet once a task is created.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="task-edit-actions">
        <button onClick={save} disabled={saving}>
          Save
        </button>
        <button onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
