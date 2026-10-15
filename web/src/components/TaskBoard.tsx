import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "../api/client";
import type { Bucket, Task, TaskOccurrence, TaskStatus, TodayViewResponse } from "../api/types";
import { applyBucketTint, readBucketSpot, saveBucketSpot } from "../theme/bucketTheme";
import { EasyWinsStrip } from "./EasyWinsStrip";
import { FilterIcon } from "./icons";
import { TaskRow } from "./TaskRow";
import { OccurrenceRow } from "./OccurrenceRow";
import { QuickCapture } from "./QuickCapture";

export type BoardView = "today" | "upcoming" | "later" | "all";

interface Props {
  /** Initial view — page can lock one, or user can switch. */
  initialView?: BoardView;
  title?: string;
  /** Open this task's details immediately (home easy-win). */
  focusTaskId?: string | null;
}

const VIEW_OPTIONS: { id: BoardView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "later", label: "Later" },
  { id: "all", label: "All" },
];

export function TaskBoard({ initialView = "all", title, focusTaskId }: Props) {
  const [view, setView] = useState<BoardView>(initialView);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrence[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [spot, setSpot] = useState(readBucketSpot);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ view });
    if (search) params.set("search", search);
    if (view === "all" && statusFilter) params.set("status", statusFilter);
    if (spot) params.set("bucketId", spot);

    const tasksReq =
      view === "today" || view === "upcoming"
        ? api.get<TodayViewResponse>(`/tasks?${params.toString()}`)
        : api.get<Task[]>(`/tasks?${params.toString()}`);

    tasksReq
      .then((body) => {
        if (view === "today" || view === "upcoming") {
          const tv = body as TodayViewResponse;
          setTasks(tv.tasks);
          setOccurrences(tv.occurrences);
        } else {
          setTasks(body as Task[]);
          setOccurrences([]);
        }
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [view, search, statusFilter, spot]);

  useEffect(load, [load]);
  useEffect(() => {
    api.get<Bucket[]>("/buckets").then(setBuckets).catch(() => undefined);
  }, []);

  const pages = [
    { id: "", name: "All", color: null as string | null },
    ...buckets
      .filter((b) => !b.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((b) => ({ id: b.id, name: b.name, color: b.color })),
  ];
  const pageIndex = Math.max(0, pages.findIndex((p) => p.id === spot));
  const page = pages[pageIndex] ?? pages[0];

  const pagesRef = useRef(pages);
  const spotRef = useRef(spot);
  pagesRef.current = pages;
  spotRef.current = page.id;
  const boardRef = useRef<HTMLDivElement>(null);
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
  }, [buckets, spot]);

  useEffect(() => {
    applyBucketTint(page.color);
    return () => applyBucketTint(null);
  }, [page.color]);

  useEffect(() => {
    const el = boardRef.current;
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

  async function completeTask(t: Task) {
    await api.post(`/tasks/${t.id}/complete`);
    load();
  }
  async function undoTask(t: Task) {
    await api.post(`/tasks/${t.id}/undo`);
    load();
  }
  async function snoozeByDays(t: Task, days: number) {
    const until = new Date();
    until.setDate(until.getDate() + days);
    await api.post(`/tasks/${t.id}/snooze`, { until: until.toISOString() });
    load();
  }
  async function dropTask(t: Task) {
    await api.post(`/tasks/${t.id}/drop`);
    load();
  }
  async function renameTask(t: Task, title: string) {
    await api.patch(`/tasks/${t.id}`, { title });
    load();
  }
  async function addToToday(t: Task) {
    await api.patch(`/tasks/${t.id}`, { attentionDate: new Date().toISOString(), status: "active" });
    load();
  }

  const pending = view === "today" ? tasks.filter((t) => t.status === "active") : tasks;
  const completed = view === "today" ? tasks.filter((t) => t.status === "completed") : [];
  const pendingOccurrences = occurrences.filter((o) => o.status === "pending" || view !== "today");
  const completedOccurrences = view === "today" ? occurrences.filter((o) => o.status === "completed") : [];

  const heading =
    title ??
    (view === "today" ? "Today" : view === "upcoming" ? "Upcoming" : view === "later" ? "Later" : "All tasks");

  return (
    <div
      className="page task-board"
      ref={boardRef}
      onPointerDown={onBoardPointerDown}
      onPointerUp={onBoardPointerUp}
      onPointerCancel={() => {
        dragStart.current = null;
      }}
    >
      <div className="board-title-row">
        <h1>{heading}</h1>
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
      </div>
      <div className="view-filters" role="tablist" aria-label="Task view">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={view === opt.id}
            className={`view-chip${view === opt.id ? " active" : ""}`}
            onClick={() => setView(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="bucket-pager" aria-label="Buckets">
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

      {view === "today" && <EasyWinsStrip />}

      <QuickCapture onCaptured={load} addToToday />

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
            onSnooze={(days) => snoozeByDays(t, days)}
            onDrop={() => dropTask(t)}
            onRename={(title) => renameTask(t, title)}
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
              await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
              load();
            }}
            onUndo={async () => {
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
                onSnooze={(days) => snoozeByDays(t, days)}
                onDrop={() => dropTask(t)}
                onRename={(title) => renameTask(t, title)}
                buckets={buckets}
                onDetailsSaved={load}
              />
            ))}
            {completedOccurrences.map((o) => (
              <OccurrenceRow
                key={o.id}
                occurrence={o}
                onComplete={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
                  load();
                }}
                onUndo={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
                  load();
                }}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
