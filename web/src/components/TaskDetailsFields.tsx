import type { Bucket, Effort, Importance } from "../api/types";

// Shared, optional-field editor used by both task creation ("More details")
// and editing an existing task. Every field here is optional by design --
// nothing here forces information into the title.
export interface TaskDetailsValue {
  bucketId: string; // "" = no bucket
  importance: Importance;
  effort: "" | Effort;
  deadline: string; // datetime-local input value, "" = none
  estimateMinutes: string; // raw input string, "" = none
  waitingOn: string;
  notes: string;
}

export const emptyTaskDetails: TaskDetailsValue = {
  bucketId: "",
  importance: "medium",
  effort: "",
  deadline: "",
  estimateMinutes: "",
  waitingOn: "",
  notes: "",
};

interface Props {
  value: TaskDetailsValue;
  onChange: (value: TaskDetailsValue) => void;
  buckets: Bucket[];
}

export function TaskDetailsFields({ value, onChange, buckets }: Props) {
  function set<K extends keyof TaskDetailsValue>(key: K, v: TaskDetailsValue[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="task-details-fields">
      <label>
        Bucket
        <select
          value={value.bucketId || buckets.find((b) => b.isDefault)?.id || buckets[0]?.id || ""}
          onChange={(e) => set("bucketId", e.target.value)}
        >
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Importance
        <select value={value.importance} onChange={(e) => set("importance", e.target.value as Importance)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label>
        Hard deadline (optional)
        <input type="datetime-local" value={value.deadline} onChange={(e) => set("deadline", e.target.value)} />
      </label>
      <fieldset className="effort-field">
        <legend>Effort</legend>
        <div className="effort-choices" role="group" aria-label="Effort">
          {(["low", "medium", "high"] as const).map((level) => (
            <button
              key={level}
              type="button"
              className={`view-chip${value.effort === level ? " active" : ""}`}
              aria-pressed={value.effort === level}
              onClick={() => set("effort", value.effort === level ? "" : level)}
            >
              {level === "low" ? "Low" : level === "medium" ? "Medium" : "High"}
            </button>
          ))}
        </div>
        <p className="muted small">Low can be an easy win. Medium only at 45 minutes. High never is. Leave it unset and the time guess decides.</p>
      </fieldset>
      <label>
        Estimate (minutes)
        <input
          type="number"
          min={0}
          value={value.estimateMinutes}
          onChange={(e) => set("estimateMinutes", e.target.value)}
          placeholder="e.g. 30"
        />
      </label>
      <label>
        Waiting on (optional)
        <input
          value={value.waitingOn}
          onChange={(e) => set("waitingOn", e.target.value)}
          placeholder="e.g. reply from the band"
        />
      </label>
      <label className="notes-label">
        Notes
        <textarea value={value.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </label>
    </div>
  );
}
