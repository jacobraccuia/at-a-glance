import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { branding } from "../config/branding";
import type { Bucket, Task, TaskOccurrence, TaskStatus, TodayViewResponse } from "../api/types";
import {
  applyBucketTint,
  isWorkBucket,
  readBucketSpot,
  readHideWork,
  readHideFinished,
  readWinMinutes,
  saveBucketSpot,
  saveHideWork,
  saveHideFinished,
  saveWinMinutes,
} from "../theme/bucketTheme";
import { EasyWinsStrip } from "./EasyWinsStrip";
import { FilterIcon, ProfileIcon } from "./icons";
import { TaskEditPanel } from "./TaskEditPanel";
import { TaskRow } from "./TaskRow";
import { OccurrenceRow } from "./OccurrenceRow";
import { QuickCapture } from "./QuickCapture";

export type BoardView = "today" | "tomorrow" | "nextWeek" | "later" | "all";
export type MoveHorizon = "today" | "tomorrow" | "nextWeek" | "later";

const DATED_VIEWS = new Set<BoardView>(["today", "tomorrow", "nextWeek", "later"]);

interface Props {
  /** Initial view — page can lock one, or user can switch. */
  initialView?: BoardView;
  /** Open this task's details immediately (home easy-win). */
  focusTaskId?: string | null;
}

const VIEW_OPTIONS: { id: BoardView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "nextWeek", label: "Next week" },
  { id: "later", label: "Later" },
  { id: "all", label: "All" },
];

export function TaskBoard({ initialView = "all", focusTaskId }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<BoardView>(initialView);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrence[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [spot, setSpot] = useState(readBucketSpot);
  const [hideWork, setHideWork] = useState(readHideWork);
  const [hideFinished, setHideFinished] = useState(readHideFinished);
  const [winMinutes, setWinMinutes] = useState(readWinMinutes);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [winsToken, setWinsToken] = useState(0);
  const [hiddenWinIds, setHiddenWinIds] = useState<string[]>([]);
  const [easyEdit, setEasyEdit] = useState<Task | null>(null);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  function chooseView(next: BoardView) {
    setView(next);
    if (next === "all") {
      navigate("/all");
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete("task");
    if (next === "today") params.delete("view");
    else params.set("view", next);
    const search = params.toString();
    navigate({ pathname: "/", search: search ? `?${search}` : "" });
  }

  const loadTicket = useRef(0);
  const load = useCallback(() => {
    const mine = ++loadTicket.current;
    setLoading(true);
    setWinsToken((n) => n + 1);
    const params = new URLSearchParams({ view });
    if (search) params.set("search", search);
    if (view === "all" && statusFilter) params.set("status", statusFilter);
    if (spot) params.set("bucketId", spot);
    else if (hideWork) params.set("excludeBucketName", "Work");

    const tasksReq = DATED_VIEWS.has(view)
      ? api.get<TodayViewResponse>(`/tasks?${params.toString()}`)
      : api.get<Task[]>(`/tasks?${params.toString()}`);

    tasksReq
      .then((body) => {
        if (mine !== loadTicket.current) return;
        if (DATED_VIEWS.has(view)) {
          const tv = body as TodayViewResponse;
          setTasks(tv.tasks);
          setOccurrences(tv.occurrences);
        } else {
          setTasks(body as Task[]);
          setOccurrences([]);
        }
        setError(null);
      })
      .catch((e) => {
        if (mine === loadTicket.current) setError(e.message);
      })
      .finally(() => {
        if (mine === loadTicket.current) setLoading(false);
      });
  }, [view, search, statusFilter, spot, hideWork]);

  useEffect(load, [load]);
  useEffect(() => {
    const onTasks = () => load();
    window.addEventListener("taskr-tasks-changed", onTasks);
    return () => window.removeEventListener("taskr-tasks-changed", onTasks);
  }, [load]);
  useEffect(() => {
    api.get<Bucket[]>("/buckets").then(setBuckets).catch(() => undefined);
  }, []);

  const openBuckets = buckets
    .filter((b) => !b.archivedAt)
    .filter((b) => !(hideWork && isWorkBucket(b.name)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const pages = [
    { id: "", name: "All buckets", color: null as string | null },
    ...openBuckets.map((b) => ({ id: b.id, name: b.name, color: b.color })),
  ];
  const pageIndex = Math.max(0, pages.findIndex((p) => p.id === spot));
  const page = pages[pageIndex] ?? pages[0];

  const pagesRef = useRef(pages);
  const spotRef = useRef(spot);
  pagesRef.current = pages;
  spotRef.current = page.id;
  const pagerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; id: number } | null>(null);

  function chooseSpot(id: string) {
    setSpot(id);
    saveBucketSpot(id);
  }

  function shiftSpot(dir: number) {
    const list = pagesRef.current;
    if (list.length < 2) return;
    const i = Math.max(0, list.findIndex((p) => p.id === spotRef.current));
    const next = Math.min(list.length - 1, Math.max(0, i + dir));
    if (next !== i) chooseSpot(list[next].id);
  }

  useEffect(() => {
    if (spot && buckets.length > 0 && !pages.some((p) => p.id === spot)) chooseSpot("");
  }, [buckets, spot, hideWork]);

  function toggleHideWork() {
    const next = !hideWork;
    setHideWork(next);
    saveHideWork(next);
    const current = buckets.find((b) => b.id === spot);
    if (next && current && isWorkBucket(current.name)) chooseSpot("");
  }

  function toggleHideFinished() {
    const next = !hideFinished;
    setHideFinished(next);
    saveHideFinished(next);
  }

  function chooseMinutes(minutes: number) {
    setWinMinutes(minutes);
    saveWinMinutes(minutes);
  }

  useEffect(() => {
    applyBucketTint(page.color);
    return () => applyBucketTint(null);
  }, [page.color]);

  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    let acc = 0;
    let lockUntil = 0;
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.4) {
        acc = 0;
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest(".swipe-content, input, textarea, select")) return;
      if (Math.abs(e.deltaX) < 6) return;
      e.preventDefault();
      const now = Date.now();
      if (now < lockUntil) return;
      acc += e.deltaX;
      if (Math.abs(acc) < 80) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      lockUntil = now + 420;
      const list = pagesRef.current;
      if (list.length < 2) return;
      const i = Math.max(0, list.findIndex((p) => p.id === spotRef.current));
      const next = Math.min(list.length - 1, Math.max(0, i + dir));
      if (next === i) return;
      const id = list[next].id;
      setSpot(id);
      saveBucketSpot(id);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onBoardPointerDown(e: ReactPointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".swipe-content, input, textarea, select, a, button")) return;
    dragStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onBoardPointerUp(e: ReactPointerEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    shiftSpot(dx < 0 ? 1 : -1);
  }

  function hideWin(id: string) {
    setHiddenWinIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }
  function showWin(id: string) {
    setHiddenWinIds((ids) => ids.filter((x) => x !== id));
  }

  async function completeTask(t: Task) {
    await completeId(t.id);
  }
  async function completeId(id: string) {
    hideWin(id);
    await api.post(`/tasks/${id}/complete`);
    load();
  }
  async function undoTask(t: Task) {
    showWin(t.id);
    await api.post(`/tasks/${t.id}/undo`);
    load();
  }
  async function moveHorizon(t: Task, horizon: MoveHorizon) {
    await api.post(`/tasks/${t.id}/horizon`, { horizon });
    load();
  }
  async function dropTask(t: Task) {
    hideWin(t.id);
    await api.post(`/tasks/${t.id}/drop`);
    load();
  }
  async function addToToday(t: Task) {
    await moveHorizon(t, "today");
  }

  const visible = hideFinished ? tasks.filter((t) => t.status !== "completed") : tasks;
  const pending = view === "today" ? visible.filter((t) => t.status === "active") : visible;
  const completed = view === "today" && !hideFinished ? tasks.filter((t) => t.status === "completed") : [];
  const pendingOccurrences = occurrences.filter((o) => {
    if (hideFinished && o.status === "completed") return false;
    return o.status === "pending" || view !== "today";
  });
  const completedOccurrences = view === "today" && !hideFinished ? occurrences.filter((o) => o.status === "completed") : [];

  return (
    <div className="page task-board">
      <div className="board-title-row">
        <h1>{branding.appName}</h1>
        <div className="board-title-actions">
          <button
            type="button"
            className={`icon-button filter-toggle${filtersOpen || search || spot || statusFilter ? " active" : ""}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-label="Search and filter"
            title="Search and filter"
          >
            <FilterIcon />
          </button>
          <NavLink to="/account" className="header-profile" aria-label="Account" title="Account">
            <ProfileIcon />
          </NavLink>
        </div>
      </div>
      <div className="view-filters" role="tablist" aria-label="Task view">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={view === opt.id}
            className={`view-chip${view === opt.id ? " active" : ""}`}
            onClick={() => chooseView(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="bucket-block">
        <div
          className="bucket-pager"
          aria-label="Buckets"
          ref={pagerRef}
          onPointerDown={onBoardPointerDown}
          onPointerUp={onBoardPointerUp}
          onPointerCancel={() => {
            dragStart.current = null;
          }}
        >
          <button type="button" className="bucket-pager-arrow" onClick={() => shiftSpot(-1)} disabled={pageIndex <= 0} aria-label="Previous bucket">
            ‹
          </button>
          <div className="bucket-pager-main">
            <div className="bucket-pager-name">{page.name}</div>
            {pages.length > 1 && (
              <div className="bucket-dots">
                {pages.map((p, i) => (
                  <button
                    key={p.id || "all"}
                    type="button"
                    className={`bucket-dot${i === pageIndex ? " on" : ""}`}
                    aria-label={p.name}
                    aria-current={i === pageIndex ? "true" : undefined}
                    onClick={() => chooseSpot(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="bucket-pager-arrow"
            onClick={() => shiftSpot(1)}
            disabled={pageIndex >= pages.length - 1}
            aria-label="Next bucket"
          >
            ›
          </button>
        </div>
      </div>

      {view === "today" && (
        <EasyWinsStrip
          minutes={winMinutes}
          onMinutes={chooseMinutes}
          bucketId={spot}
          hideWork={hideWork}
          refreshToken={winsToken}
          hiddenIds={hiddenWinIds}
          onOpen={(id) => {
            void api.get<Task>(`/tasks/${id}`).then(setEasyEdit).catch(() => undefined);
          }}
        />
      )}

      {easyEdit && (
        <TaskEditPanel
          task={easyEdit}
          buckets={buckets}
          onSaved={load}
          onClose={() => setEasyEdit(null)}
        />
      )}

      <QuickCapture onCaptured={load} />

      {filtersOpen && (
      <div className="filters">
        <input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {view === "all" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}>
            <option value="">Open</option>
            <option value="captured">Captured</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="dropped">Dropped</option>
          </select>
        )}
        <select value={spot} onChange={(e) => chooseSpot(e.target.value)}>
          <option value="">All buckets</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      )}

      {error && <p className="error">{error}</p>}
      {loading && tasks.length === 0 && <p className="muted">Loading…</p>}

      <ul className="task-list">
        {pending.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onComplete={() => completeTask(t)}
            onUndo={() => undoTask(t)}
            onMove={(horizon) => moveHorizon(t, horizon)}
            onDrop={() => dropTask(t)}
            onAddToToday={view === "today" ? undefined : () => addToToday(t)}
            buckets={buckets}
            onDetailsSaved={load}
            startDetailsOpen={focusTaskId === t.id}
          />
        ))}
        {(view === "today" ? pendingOccurrences.filter((o) => o.status === "pending") : pendingOccurrences).map((o) => (
          <OccurrenceRow
            key={o.id}
            occurrence={o}
            onComplete={async () => {
              hideWin(o.taskId);
              await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
              load();
            }}
            onUndo={async () => {
              showWin(o.taskId);
              await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
              load();
            }}
          />
        ))}
      </ul>
      {!loading &&
        pending.length === 0 &&
        pendingOccurrences.length === 0 &&
        completed.length === 0 &&
        completedOccurrences.length === 0 && <p className="muted">Nothing here.</p>}

      {view === "today" && (completed.length > 0 || completedOccurrences.length > 0) && (
        <details className="completed-section">
          <summary>{completed.length + completedOccurrences.length} done</summary>
          <ul className="task-list">
            {completed.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onComplete={() => completeTask(t)}
                onUndo={() => undoTask(t)}
                onMove={(horizon) => moveHorizon(t, horizon)}
                onDrop={() => dropTask(t)}
                buckets={buckets}
                onDetailsSaved={load}
              />
            ))}
            {completedOccurrences.map((o) => (
              <OccurrenceRow
                key={o.id}
                occurrence={o}
                onComplete={async () => {
                  hideWin(o.taskId);
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
                  load();
                }}
                onUndo={async () => {
                  showWin(o.taskId);
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
                  load();
                }}
              />
            ))}
          </ul>
        </details>
      )}
      <div className="list-switches">
        <button
          type="button"
          className={`view-chip hide-work${hideWork ? " active" : ""}`}
          aria-pressed={hideWork}
          title="Leaves the Work bucket out of this switcher"
          onClick={toggleHideWork}
        >
          {hideWork ? "Work hidden" : "Hide work"}
        </button>
        <button
          type="button"
          className={`view-chip hide-work${hideFinished ? " active" : ""}`}
          aria-pressed={hideFinished}
          title="Leaves completed tasks out of this list"
          onClick={toggleHideFinished}
        >
          {hideFinished ? "Finished hidden" : "Hide finished"}
        </button>
      </div>
    </div>
  );
}
