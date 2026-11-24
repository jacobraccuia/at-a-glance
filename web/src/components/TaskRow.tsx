import { useState } from "react";
import type { Bucket, Task } from "../api/types";
import { doneIn } from "../lib/doneIn";
import { useCelebrate } from "../hooks/useCelebrate";
import { useSwipeRow } from "../hooks/useSwipeRow";
import { DoneSparkles } from "./DoneSparkles";
import { TaskEditPanel } from "./TaskEditPanel";
import { CheckIcon, DropIcon, LaterIcon, SnoozeIcon } from "./icons";

interface Props {
  task: Task;
  onComplete: () => void;
  onUndo: () => void;
  onMove: (horizon: "today" | "tomorrow" | "nextWeek" | "later") => void;
  onDrop: () => void;
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
  onMove,
  onDrop,
  onAddToToday,
  buckets,
  onDetailsSaved,
  startDetailsOpen = false,
}: Props) {
  const isDone = task.status === "completed";
  const span = isDone ? doneIn(task.createdAt, task.completedAt) : null;
  const [detailsOpen, setDetailsOpen] = useState(startDetailsOpen);
  const { poof, celebrate } = useCelebrate(onComplete);

  // Swipe left to complete. Swipe right a little for Tomorrow, further for Next week.
  // Disabled once a task is already done, and while renaming inline, so a
  // drag inside the title-edit input doesn't fight with text selection.
  const canToday = Boolean(onAddToToday);
  const { dragX, dragging, stage, handlers } = useSwipeRow({
    disabled: isDone || poof,
    zones: canToday ? 3 : 2,
    onSwipeLeft: celebrate,
    onSwipeRightNear: canToday ? onAddToToday : () => onMove("tomorrow"),
    onSwipeRightMid: canToday ? () => onMove("tomorrow") : undefined,
    onSwipeRightFar: () => onMove("nextWeek"),
  });
  const rightLabel =
    stage === "right-far" ? "Next week" : stage === "right-mid" ? "Tomorrow" : canToday ? "Today" : "Tomorrow";

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
                stage === "right-near" || stage === "right-mid" ? " armed" : stage === "right-far" ? " armed far" : ""
              }`}
            >
              <SnoozeIcon />
              <span>{rightLabel}</span>
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
              <button type="button" className="task-title" onClick={() => buckets && setDetailsOpen((open) => !open)}>
                {task.title}
              </button>
              <div className="task-meta">
                {task.bucket && <span className="pill" style={{ borderColor: task.bucket.color ?? undefined }}>{task.bucket.name}</span>}
                {task.hardDeadline && (
                  <span className="pill deadline">Due {new Date(task.hardDeadline).toLocaleDateString()}</span>
                )}
                {task.importance === "high" && <span className="pill importance-high">Important</span>}
                {task.effort === "low" && <span className="pill">Low effort</span>}
                {task.effort === "medium" && <span className="pill">Medium effort</span>}
                {task.effort === "high" && <span className="pill">High effort</span>}
                {task.waitingOn && <span className="pill waiting">Waiting: {task.waitingOn}</span>}
                {task.estimateMinutes != null && <span className="pill">~{task.estimateMinutes}m</span>}
                {span && <span className="pill">{span}</span>}
                {task.notes && <span className="pill">Has notes</span>}
              </div>
            </div>
            {!isDone && (
              <div className="task-actions">
                <button className="icon-button" onClick={() => onMove("tomorrow")} title="Tomorrow" aria-label="Move to tomorrow">
                  <SnoozeIcon />
                </button>
                <button className="icon-button" onClick={() => onMove("later")} title="Later" aria-label="Move to later">
                  <LaterIcon />
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
