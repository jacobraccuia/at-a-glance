import { useState } from "react";
import type { Task } from "../api/types";

interface Props {
  task: Task;
  onComplete: () => void;
  onUndo: () => void;
  onSnoozeTomorrow: () => void;
  onDrop: () => void;
  onRename: (newTitle: string) => void;
  onAddToToday?: () => void;
}

function isAttentionDateToday(attentionDate: string | null): boolean {
  if (!attentionDate) return false;
  const today = new Date();
  const d = new Date(attentionDate);
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

export function TaskRow({ task, onComplete, onUndo, onSnoozeTomorrow, onDrop, onRename, onAddToToday }: Props) {
  const isDone = task.status === "completed";
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);

  function commitRename() {
    setEditing(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== task.title) {
      onRename(trimmed);
    } else {
      setDraftTitle(task.title);
    }
  }

  return (
    <li className={`task-row${isDone ? " done" : ""}`}>
      <input type="checkbox" checked={isDone} onChange={isDone ? onUndo : onComplete} />
      <div className="task-row-main">
        {editing ? (
          <input
            className="task-title-edit"
            value={draftTitle}
            autoFocus
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraftTitle(task.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="task-title" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {task.title}
          </span>
        )}
        <div className="task-meta">
          {task.bucket && <span className="pill" style={{ borderColor: task.bucket.color ?? undefined }}>{task.bucket.name}</span>}
          {task.hardDeadline && (
            <span className="pill deadline">Due {new Date(task.hardDeadline).toLocaleDateString()}</span>
          )}
          {task.importance === "high" && <span className="pill importance-high">Important</span>}
          {task.waitingOn && <span className="pill waiting">Waiting: {task.waitingOn}</span>}
        </div>
      </div>
      {!isDone && (
        <div className="task-actions">
          {onAddToToday && !task.recurrenceRuleId && !isAttentionDateToday(task.attentionDate) && (
            <button onClick={onAddToToday} title="Add to Today">
              Add to Today
            </button>
          )}
          <button onClick={onSnoozeTomorrow} title="Snooze until tomorrow">
            Snooze
          </button>
          <button onClick={onDrop} title="Drop this task">
            Drop
          </button>
        </div>
      )}
    </li>
  );
}
