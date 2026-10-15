import { useState } from "react";
import type { Bucket, Task } from "../api/types";
import { useCelebrate } from "../hooks/useCelebrate";
import { useSwipeRow } from "../hooks/useSwipeRow";
import { DoneSparkles } from "./DoneSparkles";
import { TaskEditPanel } from "./TaskEditPanel";
import { CheckIcon, DetailsIcon, DropIcon, PlusIcon, SnoozeIcon } from "./icons";

interface Props {
  task: Task;
  onComplete: () => void;
  onUndo: () => void;
  onSnooze: (days: number) => void;
  onDrop: () => void;
  onRename: (newTitle: string) => void;
  onAddToToday?: () => void;
  buckets?: Bucket[];
  onDetailsSaved?: () => void;
  /** Open the details panel on first render (home easy-win tap). */
  startDetailsOpen?: boolean;
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

export function TaskRow({
  task,
  onComplete,
  onUndo,
  onSnooze,
  onDrop,
  onRename,
  onAddToToday,
  buckets,
  onDetailsSaved,
  startDetailsOpen = false,
}: Props) {
  const isDone = task.status === "completed";
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [detailsOpen, setDetailsOpen] = useState(startDetailsOpen);
  const { poof, celebrate } = useCelebrate(onComplete);

  // Swipe left to complete, swipe right (near/far) to snooze to a near
  // (tomorrow) or far (3 days) default -- see useSwipeRow for thresholds.
  // Disabled once a task is already done, and while renaming inline, so a
  // drag inside the title-edit input doesn't fight with text selection.
  const { dragX, dragging, stage, handlers } = useSwipeRow({
    disabled: isDone || editing || poof,
    onSwipeLeft: celebrate,
    onSwipeRightNear: () => onSnooze(1),
    onSwipeRightFar: () => onSnooze(3),
  });

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
    <li className={`task-row${isDone ? " done" : ""}${poof ? " poof" : ""}`}>
      {poof && <DoneSparkles />}
      <div className="swipe-row">
        {/* Dragging the content right exposes the LEFT side of this
            background layer (and vice versa) -- so the snooze indicator,
            which arms on a rightward drag, lives in swipe-bg-left, and the
            complete indicator, which arms on a leftward drag, lives in
            swipe-bg-right. This is intentionally the reverse of where the
            gesture itself points. */}
        {!isDone && (
          <div className="swipe-bg">
            <div
              className={`swipe-bg-side swipe-bg-left swipe-action-snooze${
                stage === "right-near" ? " armed" : stage === "right-far" ? " armed far" : ""
              }`}
            >
              <SnoozeIcon />
              <span>{stage === "right-far" ? "3 days" : "Tomorrow"}</span>
            </div>
            <div className={`swipe-bg-side swipe-bg-right swipe-action-complete${stage === "left" ? " armed" : ""}`}>
              <CheckIcon />
              <span>Done</span>
            </div>
          </div>
        )}
        <div
          className="swipe-content"
          style={{
            transform: `translateX(${dragX}px)`,
            transition: dragging ? "none" : "transform 0.2s ease",
          }}
          {...handlers}
        >
          <div className="task-row-top">
            <button
              type="button"
              className={`done-toggle${isDone ? " is-done" : ""}`}
              onClick={isDone ? onUndo : celebrate}
              aria-label={isDone ? "Mark not done" : "Mark done"}
              title={isDone ? "Undo" : "Done"}
            >
              <CheckIcon />
            </button>
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
                {task.estimateMinutes != null && <span className="pill">~{task.estimateMinutes}m</span>}
                {task.notes && <span className="pill">Has notes</span>}
              </div>
            </div>
            {!isDone && (
              <div className="task-actions">
                {onAddToToday && !task.recurrenceRuleId && !isAttentionDateToday(task.attentionDate) && (
                  <button className="icon-button add-today" onClick={onAddToToday} title="Add to Today" aria-label="Add to Today">
                    <PlusIcon />
                  </button>
                )}
                {buckets && (
                  <button
                    className={`icon-button${detailsOpen ? " active" : ""}`}
                    onClick={() => setDetailsOpen((o) => !o)}
                    title={detailsOpen ? "Close details" : "Edit details"}
                    aria-label="Edit details"
                  >
                    <DetailsIcon />
                  </button>
                )}
                <button className="icon-button" onClick={() => onSnooze(1)} title="Snooze until tomorrow" aria-label="Snooze until tomorrow">
                  <SnoozeIcon />
                </button>
                <button className="icon-button danger" onClick={onDrop} title="Drop this task" aria-label="Drop this task">
                  <DropIcon />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {detailsOpen && buckets && (
        <TaskEditPanel
          task={task}
          buckets={buckets}
          onSaved={() => onDetailsSaved?.()}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </li>
  );
}
