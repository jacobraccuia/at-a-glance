import type { TaskOccurrence } from "../api/types";

interface Props {
  occurrence: TaskOccurrence;
  onComplete: () => void;
  onUndo: () => void;
}

export function OccurrenceRow({ occurrence, onComplete, onUndo }: Props) {
  const isDone = occurrence.status === "completed";
  return (
    <li className={`task-row${isDone ? " done" : ""}`}>
      <div className="task-row-top">
        <input type="checkbox" checked={isDone} onChange={isDone ? onUndo : onComplete} />
        <div className="task-row-main">
          <span className="task-title">{occurrence.task?.title}</span>
          <div className="task-meta">
            <span className="pill recurring">Recurring</span>
            {occurrence.task?.bucket && (
              <span className="pill" style={{ borderColor: occurrence.task.bucket.color ?? undefined }}>
                {occurrence.task.bucket.name}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
