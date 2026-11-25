import { useState } from "react";
import type { Bucket, Task } from "../api/types";
import { doneIn } from "../lib/doneIn";
import { useCelebrate } from "../hooks/useCelebrate";
import { useSwipeRow } from "../hooks/useSwipeRow";
import { DoneSparkles } from "./DoneSparkles";
import { TaskEditPanel } from "./TaskEditPanel";
import { CheckIcon, SnoozeIcon, ArchiveIcon } from "./icons";

interface Props {
  task: Task;
  onComplete: () => void;
  onUndo: () => void;
  onMove: (horizon: "today" | "tomorrow" | "nextWeek" | "later") => void;
  onDrop: () => void;
  onArchive: () => void;
  onAddToToday?: () => void;
  buckets?: Bucket[];
  onDetailsSaved?: () => void;
  /** Open the details panel on first render (home easy-win tap). */
  startDetailsOpen?: boolean;
  /** All buckets already names the place, so the row chip is just noise. */
  showBucket?: boolean;
  onCommitChange?: (committed: boolean) => void;
}

export function TaskRow({
  task,
  onComplete,
  onUndo,
  onMove,
  onDrop,
  onArchive,
  buckets,
  onDetailsSaved,
  startDetailsOpen = false,
  showBucket = true,
  onCommitChange,
}: Props) {
  const isDone = task.status === "completed";
  const span = isDone ? doneIn(task.createdAt, task.completedAt) : null;
  const [detailsOpen, setDetailsOpen] = useState(startDetailsOpen);
  const [stamp, setStamp] = useState<string | null>(null);
  const { poof, celebrate } = useCelebrate(onComplete);

  function done() {
    if (stamp || poof) return;
    setStamp("Done");
    celebrate();
  }

  function act(label: string, run: () => void) {
    if (stamp || poof) return;
    setStamp(label);
    window.setTimeout(run, 1100);
  }

  // A long swipe left archives. A long swipe right is Tomorrow, and further is Next week.
  // A short swipe snaps back so it can still change buckets.
  const { dragX, dragging, stage, handlers } = useSwipeRow({
    disabled: isDone || poof || Boolean(stamp),
    onCommitChange,
    onSwipeLeft: () => act("Archived", onArchive),
    onSwipeRightNear: () => act("Tomorrow", () => onMove("tomorrow")),
    onSwipeRightFar: () => act("Upcoming", () => onMove("nextWeek")),
  });
  const rightLabel = stage === "right-far" ? "Upcoming" : "Tomorrow";
  const swipeClass = stage === "right-far" ? " armed later" : stage === "right-near" ? " armed tomorrow" : "";

  return (
    <li className={`task-row${isDone ? " done" : ""}${poof ? " poof" : ""}${stamp ? " stamped" : ""}`}>
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
              className={`swipe-bg-side swipe-bg-left swipe-action-snooze${swipeClass}`}
            >
              <SnoozeIcon />
              <span>{rightLabel}</span>
            </div>
            <div className={`swipe-bg-side swipe-bg-right swipe-action-archive${stage === "left" ? " armed" : ""}`}>
              <ArchiveIcon />
              <span>Archive</span>
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
              onClick={isDone ? onUndo : done}
              aria-label={isDone ? "Mark not done" : "Mark done"}
              title={isDone ? "Undo" : "Done"}
            >
              <CheckIcon />
            </button>
            <div className="task-row-main">
              <button type="button" className="task-title" onClick={() => buckets && setDetailsOpen((open) => !open)}>
                {task.title}
              </button>
              {stamp && <span className="task-stamp">{stamp}</span>}
              <div className="task-meta">
                {showBucket && task.bucket && <span className="pill" style={{ borderColor: task.bucket.color ?? undefined }}>{task.bucket.name}</span>}
                {task.hardDeadline && (
                  <span className="pill deadline">Due {dueWhen(task.hardDeadline)}</span>
                )}
                {!task.hardDeadline && task.attentionDate && clockLabel(task.attentionDate) && (
                  <span className="pill">{clockLabel(task.attentionDate)}</span>
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
          </div>
        </div>
      </div>
      {detailsOpen && buckets && (
        <TaskEditPanel
          task={task}
          buckets={buckets}
          onSaved={() => onDetailsSaved?.()}
          onClose={() => setDetailsOpen(false)}
          onDelete={onDrop}
        />
      )}
    </li>
  );
}

function hasClock(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.getHours() !== 0 || date.getMinutes() !== 0;
}

function clockLabel(iso: string): string {
  if (!hasClock(iso)) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dueWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString();
  const time = clockLabel(iso);
  return time ? `${day} ${time}` : day;
}
