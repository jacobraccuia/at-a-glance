import type { TaskOccurrence } from "../api/types";
import { useCelebrate } from "../hooks/useCelebrate";
import { useSwipeRow } from "../hooks/useSwipeRow";
import { DoneSparkles } from "./DoneSparkles";
import { CheckIcon } from "./icons";

interface Props {
  occurrence: TaskOccurrence;
  onComplete: () => void;
  onUndo: () => void;
}

export function OccurrenceRow({ occurrence, onComplete, onUndo }: Props) {
  const isDone = occurrence.status === "completed";
  const { poof, celebrate } = useCelebrate(onComplete);

  // Recurring occurrences don't have their own snooze concept (snoozing
  // applies to a Task, not a single generated occurrence), so only the
  // swipe-left-to-complete gesture applies here -- no right-swipe action.
  const { dragX, dragging, stage, handlers } = useSwipeRow({
    disabled: isDone || poof,
    onSwipeLeft: celebrate,
  });

  return (
    <li className={`task-row${isDone ? " done" : ""}${poof ? " poof" : ""}`}>
      {poof && <DoneSparkles />}
      <div className="swipe-row">
        {/* Dragging left exposes the RIGHT side of this background layer,
            so the "Done" indicator (armed by a leftward swipe) lives in
            swipe-bg-right -- see the matching comment in TaskRow.tsx. */}
        {!isDone && (
          <div className="swipe-bg">
            <div className="swipe-bg-side swipe-bg-left" />
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
            <input type="checkbox" checked={isDone || poof} onChange={isDone ? onUndo : celebrate} />
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
        </div>
      </div>
    </li>
  );
}
