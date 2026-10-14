export interface User {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  isGuest?: boolean;
}

export interface Bucket {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  archivedAt: string | null;
}

export type TaskStatus = "captured" | "active" | "completed" | "dropped";
export type Importance = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  bucketId: string | null;
  bucket?: Bucket | null;
  goalId: string | null;
  attentionDate: string | null;
  hardDeadline: string | null;
  deadlineSource: "explicit" | "inferred" | null;
  estimateMinutes: number | null;
  actualMinutes: number | null;
  importance: Importance;
  waitingOn: string | null;
  recurrenceRuleId: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  droppedAt: string | null;
  createdAt: string;
  occurrences?: TaskOccurrence[];
}

export type OccurrenceStatus = "pending" | "completed" | "skipped";

export interface TaskOccurrence {
  id: string;
  taskId: string;
  occurrenceDate: string;
  status: OccurrenceStatus;
  completedAt: string | null;
  task?: Task;
}

export interface TodayViewResponse {
  tasks: Task[];
  occurrences: TaskOccurrence[];
}

export interface Stats {
  completedThisWeek: number;
  activeBacklog: number;
  byBucket: { bucketId: string | null; count: number }[];
}
