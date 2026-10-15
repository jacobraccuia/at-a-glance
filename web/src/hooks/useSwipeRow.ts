import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Mail-style swipe gesture for a task row:
// - Swipe left past a threshold -> complete the task.
// - Swipe right a short distance -> snooze to a near default (tomorrow).
// - Swipe right further past a second threshold -> snooze to a far default
//   (3 days), mirroring Mail's "swipe further for a different action" feel.
//
// This is additive, not a replacement: the existing tap-driven action
// buttons keep working exactly as before for anyone who doesn't swipe
// (mouse users, accessibility, discoverability).

export type SwipeStage = "none" | "left" | "right-near" | "right-far";

const LEFT_THRESHOLD = 76;
const RIGHT_NEAR_THRESHOLD = 76;
const RIGHT_FAR_THRESHOLD = 168;
const MAX_DRAG = 220;
// A touch/mouse move smaller than this (in either axis) doesn't yet commit
// to being a horizontal swipe vs. a vertical page scroll.
const AXIS_LOCK_DISTANCE = 14;

function stageFor(x: number): SwipeStage {
  if (x <= -LEFT_THRESHOLD) return "left";
  if (x >= RIGHT_FAR_THRESHOLD) return "right-far";
  if (x >= RIGHT_NEAR_THRESHOLD) return "right-near";
  return "none";
}

interface Options {
  onSwipeLeft?: () => void;
  onSwipeRightNear?: () => void;
  onSwipeRightFar?: () => void;
  disabled?: boolean;
}

export function useSwipeRow({ onSwipeLeft, onSwipeRightNear, onSwipeRightFar, disabled }: Options) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"none" | "horizontal" | "vertical">("none");

  function reset() {
    pointerId.current = null;
    axis.current = "none";
    setDragging(false);
    setDragX(0);
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerId.current = e.pointerId;
    startX.current = e.clientX;
    startY.current = e.clientY;
    axis.current = "none";
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (axis.current === "none") {
      if (Math.abs(dx) < AXIS_LOCK_DISTANCE && Math.abs(dy) < AXIS_LOCK_DISTANCE) return;
      // Vertical scroll wins unless the move is clearly sideways.
      axis.current = Math.abs(dx) > Math.abs(dy) * 1.6 ? "horizontal" : "vertical";
    }
    if (axis.current === "vertical") return;
    e.preventDefault();
    setDragging(true);
    setDragX(Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx)));
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    const finalStage = stageFor(dragX);
    reset();
    if (finalStage === "left") onSwipeLeft?.();
    else if (finalStage === "right-far") onSwipeRightFar?.();
    else if (finalStage === "right-near") onSwipeRightNear?.();
  }

  function onPointerCancel(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    reset();
  }

  return {
    dragX,
    dragging,
    stage: stageFor(dragX),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
