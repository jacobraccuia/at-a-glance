import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import type { Bucket, Task, TaskOccurrence, TaskStatus, TodayViewResponse } from "../api/types";
import {
  applyBucketTint,
  isWorkBucket,
  readHideWork,
  readHideFinished,
  saveBucketSpot,
  saveHideWork,
  saveHideFinished,
} from "../theme/bucketTheme";
import { branding } from "../config/branding";
import { FilterIcon, ProfileIcon, SearchIcon } from "./icons";
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

/** Last item in the bucket menu. Not a real bucket id. */
const ARCHIVE_SPOT = "__archive";

const VIEW_LABELS: { id: BoardView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "nextWeek", label: "Upcoming" },
  { id: "later", label: "Later" },
  { id: "all", label: "Everything" },
];

const HORIZON_STACKS: { id: MoveHorizon; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "nextWeek", label: "Upcoming" },
  { id: "later", label: "Later" },
];

export function TaskBoard({ initialView = "all", focusTaskId }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<BoardView>(initialView);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrence[]>([]);
  const [tomorrowTasks, setTomorrowTasks] = useState<Task[]>([]);
  const [tomorrowOccurrences, setTomorrowOccurrences] = useState<TaskOccurrence[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [spot, setSpot] = useState("");
  const [hideWork, setHideWork] = useState(readHideWork);
  const [hideFinished, setHideFinished] = useState(readHideFinished);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [archived, setArchived] = useState<Task[]>([]);

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
  const load = useCallback((_refresh?: boolean) => {
    const mine = ++loadTicket.current;
    setLoading(true);
    const params = new URLSearchParams({ view });
    if (search) params.set("search", search);
    if (view === "all" && statusFilter) params.set("status", statusFilter);

    const tasksReq = DATED_VIEWS.has(view)
      ? api.get<TodayViewResponse>(`/tasks?${params.toString()}`)
      : api.get<Task[]>(`/tasks?${params.toString()}`);
    const tomorrowReq =
      view === "today" ? api.get<TodayViewResponse>("/tasks?view=tomorrow") : Promise.resolve(null);

    Promise.all([tasksReq, tomorrowReq])
      .then(([body, soon]) => {
        if (mine !== loadTicket.current) return;
        if (DATED_VIEWS.has(view)) {
          const tv = body as TodayViewResponse;
          setTasks(tv.tasks);
          setOccurrences(tv.occurrences);
        } else {
          setTasks(body as Task[]);
          setOccurrences([]);
        }
        setTomorrowTasks(soon?.tasks ?? []);
        setTomorrowOccurrences(soon?.occurrences ?? []);
        setError(null);
      })
      .catch((e) => {
        if (mine === loadTicket.current) setError(e.message);
      })
      .finally(() => {
        if (mine === loadTicket.current) setLoading(false);
      });
  }, [view, search, statusFilter]);

  useEffect(load, [load]);
  useEffect(() => {
    const onTasks = () => load(true);
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
  const showingArchive = spot === ARCHIVE_SPOT;
  const selectedBucket = openBuckets.find((b) => b.id === spot);
  const bucketLabel = showingArchive ? "Archive" : selectedBucket?.name ?? "All buckets";

  function chooseSpot(id: string) {
    setSpot(id);
    saveBucketSpot("");
  }

  useEffect(() => {
    if (spot && spot !== ARCHIVE_SPOT && buckets.length > 0 && !openBuckets.some((b) => b.id === spot)) chooseSpot("");
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

  useEffect(() => {
    applyBucketTint(showingArchive ? null : selectedBucket?.color);
    return () => applyBucketTint(null);
  }, [selectedBucket?.color, showingArchive]);

  async function completeTask(t: Task) {
    await completeId(t.id);
  }
  async function completeId(id: string) {
    await api.post(`/tasks/${id}/complete`);
    load(true);
  }
  async function undoTask(t: Task) {
    await api.post(`/tasks/${t.id}/undo`);
    load(true);
  }
  async function moveHorizon(t: Task, horizon: MoveHorizon) {
    await api.post(`/tasks/${t.id}/horizon`, { horizon });
    load(true);
  }
  async function archiveTask(t: Task) {
    await api.post(`/tasks/${t.id}/archive`);
    load(true);
  }
  async function dropTask(t: Task) {
    await api.post(`/tasks/${t.id}/drop`);
    load(true);
  }
  async function restoreTask(id: string) {
    await api.post(`/tasks/${id}/reopen`);
    setArchived((rows) => rows.filter((row) => row.id !== id));
    load(true);
  }
  useEffect(() => {
    if (spot !== ARCHIVE_SPOT) return;
    api.get<Task[]>("/tasks?view=archived").then(setArchived).catch(() => setArchived([]));
  }, [spot]);
  async function addToToday(t: Task) {
    await moveHorizon(t, "today");
  }

  const scoped = tasks.filter((task) => inSpot(task.bucketId));
  const hideDone = statusFilter !== "completed" && (hideFinished || view === "all");
  const visible = hideDone ? scoped.filter((t) => t.status !== "completed") : scoped;
  const listed = view === "today" ? visible.filter((t) => t.status === "active") : visible;
  const pending = listed;
  const zone = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const horizonGroups = HORIZON_STACKS.map((group) => ({
    ...group,
    tasks: pending.filter((task) => taskPlace(task, zone) === group.id),
  })).filter((group) => group.tasks.length > 0);
  const tomorrowPending = tomorrowTasks.filter((task) => task.status === "active" && inSpot(task.bucketId));
  const tomorrowPendingOccurrences = tomorrowOccurrences.filter(
    (item) => item.status === "pending" && inSpot(item.task?.bucketId),
  );
  const completed = view === "today" && !hideFinished ? scoped.filter((t) => t.status === "completed") : [];
  const pendingOccurrences = occurrences.filter((o) => {
    if (!inSpot(o.task?.bucketId)) return false;
    if (hideFinished && o.status === "completed") return false;
    return o.status === "pending" || view !== "today";
  });
  const completedOccurrences =
    view === "today" && !hideFinished ? occurrences.filter((o) => o.status === "completed" && inSpot(o.task?.bucketId)) : [];

  function inSpot(bucketId: string | null | undefined) {
    if (hideWork && buckets.some((bucket) => bucket.id === bucketId && isWorkBucket(bucket.name))) return false;
    if (!spot) return true;
    return bucketId === spot;
  }

  return (
    <div className="page task-board">
      <div className="board-title-row">
        <div className="board-title-top">
          <p className="brand-mark">{branding.appName}</p>
          <div className="board-title-actions">
          <button
            type="button"
            className={`header-profile${searchOpen || search ? " active" : ""}`}
            onClick={() => setSearchOpen((o) => !o)}
            aria-expanded={searchOpen}
            aria-label="Search"
            title="Search"
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className={`header-profile${filtersOpen || statusFilter || hideWork || hideFinished ? " active" : ""}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-label="Filters"
            title="Filters"
          >
            <FilterIcon />
          </button>
          <NavLink to="/account" className="header-profile" aria-label="Account" title="Account">
            <ProfileIcon />
          </NavLink>
          {filtersOpen && (
            <>
              <button type="button" className="filters-backdrop" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />
              <div className="filters-popover">
                <div className="filters">
                  {view === "all" && (
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}>
                      <option value="">Open</option>
                      <option value="captured">Captured</option>
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="dropped">Dropped</option>
                    </select>
                  )}
                  <div className="list-switches">
                    <button
                      type="button"
                      className={`view-chip hide-work${hideWork ? " active" : ""}`}
                      aria-pressed={hideWork}
                      onClick={toggleHideWork}
                    >
                      {hideWork ? "Work hidden" : "Hide work"}
                    </button>
                    <button
                      type="button"
                      className={`view-chip hide-work${hideFinished ? " active" : ""}`}
                      aria-pressed={hideFinished}
                      onClick={toggleHideFinished}
                    >
                      {hideFinished ? "Finished hidden" : "Hide finished"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          </div>
        </div>
        <div className="board-pickers">
          <label className="view-picker">
            <span>{VIEW_LABELS.find((item) => item.id === view)?.label ?? "Today"}</span>
            <span className="view-picker-chevron" aria-hidden="true">⌄</span>
            <select value={view} aria-label="Timeframe" onChange={(e) => chooseView(e.target.value as BoardView)}>
              {VIEW_LABELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bucket-picker">
            <span>{bucketLabel}</span>
            <span className="view-picker-chevron" aria-hidden="true">⌄</span>
            <select value={spot} aria-label="Bucket" onChange={(e) => chooseSpot(e.target.value)}>
              <option value="">All buckets</option>
              {openBuckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.name}
                </option>
              ))}
              <option value={ARCHIVE_SPOT}>Archive</option>
            </select>
          </label>
        </div>
      </div>
      {(searchOpen || search) && (
        <input
          className="header-search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search"
          autoFocus
        />
      )}
      {showingArchive ? (
        <section className="archive-screen">
          {archived.length === 0 ? (
            <p className="muted">Nothing archived.</p>
          ) : (
            <ul className="task-list">
              {archived.map((task) => (
                <li key={task.id} className="task-row">
                  <div className="task-row-top">
                    <span className="task-title">{task.title}</span>
                    <button type="button" className="view-chip" onClick={() => restoreTask(task.id)}>
                      Put back
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
      <>
      {error && <p className="error">{error}</p>}
      {loading && tasks.length === 0 && <p className="muted">Loading…</p>}

      {view === "all" ? (
        horizonGroups.map((group) => (
          <section key={group.id} className="horizon-stack">
            <h2>{group.label}</h2>
            <ul className="task-list">
              {group.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onComplete={() => completeTask(t)}
                  onUndo={() => undoTask(t)}
                  onMove={(horizon) => moveHorizon(t, horizon)}
                  onDrop={() => dropTask(t)}
                  onArchive={() => archiveTask(t)}
                  onAddToToday={() => addToToday(t)}
                  buckets={buckets}
                  showBucket={spot !== ""}
                  onDetailsSaved={() => load(true)}
                  startDetailsOpen={focusTaskId === t.id}
                />
              ))}
            </ul>
          </section>
        ))
      ) : (
      <ul className="task-list">
        {pending.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onComplete={() => completeTask(t)}
            onUndo={() => undoTask(t)}
            onMove={(horizon) => moveHorizon(t, horizon)}
            onDrop={() => dropTask(t)}
            onArchive={() => archiveTask(t)}
            onAddToToday={view === "today" ? undefined : () => addToToday(t)}
            buckets={buckets}
            showBucket={spot !== ""}
            onDetailsSaved={() => load(true)}
            startDetailsOpen={focusTaskId === t.id}
          />
        ))}
        {(view === "today" ? pendingOccurrences.filter((o) => o.status === "pending") : pendingOccurrences).map((o) => (
          <OccurrenceRow
            key={o.id}
            occurrence={o}
            onComplete={async () => {
              await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
              load(true);
            }}
            onUndo={async () => {
              await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
              load(true);
            }}
          />
        ))}
      </ul>
      )}
      {!loading &&
        pending.length === 0 &&
        pendingOccurrences.length === 0 &&
        completed.length === 0 &&
        completedOccurrences.length === 0 && (
          <p className="muted">{view === "today" ? "Nothing for today." : "Nothing here."}</p>
        )}

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
                onArchive={() => archiveTask(t)}
                buckets={buckets}
                showBucket={spot !== ""}
                onDetailsSaved={() => load(true)}
              />
            ))}
            {completedOccurrences.map((o) => (
              <OccurrenceRow
                key={o.id}
                occurrence={o}
                onComplete={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
                  load(true);
                }}
                onUndo={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
                  load(true);
                }}
              />
            ))}
          </ul>
        </details>
      )}
      {view === "today" && (tomorrowPending.length > 0 || tomorrowPendingOccurrences.length > 0) && (
        <section className="tomorrow-peek">
          <h2>Tomorrow</h2>
          <ul className="task-list">
            {tomorrowPending.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onComplete={() => completeTask(t)}
                onUndo={() => undoTask(t)}
                onMove={(horizon) => moveHorizon(t, horizon)}
                onDrop={() => dropTask(t)}
                onArchive={() => archiveTask(t)}
                onAddToToday={() => addToToday(t)}
                buckets={buckets}
                showBucket={spot !== ""}
                onDetailsSaved={() => load(true)}
              />
            ))}
            {tomorrowPendingOccurrences.map((o) => (
              <OccurrenceRow
                key={o.id}
                occurrence={o}
                onComplete={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/complete`);
                  load(true);
                }}
                onUndo={async () => {
                  await api.post(`/tasks/${o.taskId}/occurrences/${o.id}/undo`);
                  load(true);
                }}
              />
            ))}
          </ul>
        </section>
      )}
      <QuickCapture onCaptured={() => load(true)} />
      </>
      )}
    </div>
  );
}

function calendarDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant);
}

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Attention date, else deadline. No date, a past date, or a date after Upcoming is Later. */
function taskPlace(task: Task, timeZone: string): MoveHorizon {
  const raw = task.attentionDate ?? task.hardDeadline;
  if (!raw) return "later";
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return "later";
  const day = calendarDay(instant, timeZone);
  const today = calendarDay(new Date(), timeZone);
  if (day === today) return "today";
  if (day === shiftDay(today, 1)) return "tomorrow";
  const start = shiftDay(today, 2);
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const end = shiftDay(shiftDay(today, -weekday), 13);
  if (day >= start && day <= (end < start ? start : end)) return "nextWeek";
  return "later";
}
