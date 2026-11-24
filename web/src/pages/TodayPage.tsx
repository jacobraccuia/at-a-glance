import { useSearchParams } from "react-router-dom";
import { TaskBoard, type BoardView } from "../components/TaskBoard";

const AHEAD = new Set<BoardView>(["tomorrow", "nextWeek", "later"]);

export function TodayPage() {
  const [params] = useSearchParams();
  const raw = params.get("view");
  const view: BoardView = raw && AHEAD.has(raw as BoardView) ? (raw as BoardView) : "today";
  return <TaskBoard initialView={view} />;
}
