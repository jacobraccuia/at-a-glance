import { useSearchParams } from "react-router-dom";
import { TaskBoard, type BoardView } from "../components/TaskBoard";

const VIEWS = new Set<BoardView>(["today", "upcoming", "later", "all"]);

export function AllTasksPage() {
  const [params] = useSearchParams();
  const raw = params.get("view");
  const initialView: BoardView = raw && VIEWS.has(raw as BoardView) ? (raw as BoardView) : "all";
  const focusTaskId = params.get("task");
  return <TaskBoard initialView={initialView} focusTaskId={focusTaskId} />;
}
