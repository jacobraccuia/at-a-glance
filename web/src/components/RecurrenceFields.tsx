export interface RecurrenceValue {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  interval: string; // raw input, "" treated as 1
  byWeekday: number[]; // 0=Sun..6=Sat
  byMonthday: string; // raw input
}

export const emptyRecurrence: RecurrenceValue = {
  enabled: false,
  frequency: "weekly",
  interval: "1",
  byWeekday: [],
  byMonthday: "",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  value: RecurrenceValue;
  onChange: (value: RecurrenceValue) => void;
}

export function RecurrenceFields({ value, onChange }: Props) {
  function set<K extends keyof RecurrenceValue>(key: K, v: RecurrenceValue[K]) {
    onChange({ ...value, [key]: v });
  }

  function toggleWeekday(day: number) {
    const has = value.byWeekday.includes(day);
    set("byWeekday", has ? value.byWeekday.filter((d) => d !== day) : [...value.byWeekday, day].sort());
  }

  return (
    <div className="recurrence-fields">
      <label className="checkbox-label">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        Repeats
      </label>
      {value.enabled && (
        <div className="recurrence-detail">
          <label>
            Every
            <input
              type="number"
              min={1}
              value={value.interval}
              onChange={(e) => set("interval", e.target.value)}
              style={{ width: 50 }}
            />
          </label>
          <select value={value.frequency} onChange={(e) => set("frequency", e.target.value as RecurrenceValue["frequency"])}>
            <option value="daily">day(s)</option>
            <option value="weekly">week(s)</option>
            <option value="monthly">month(s)</option>
          </select>
          {value.frequency === "weekly" && (
            <div className="weekday-picker">
              {WEEKDAY_LABELS.map((label, i) => (
                <button
                  type="button"
                  key={label}
                  className={value.byWeekday.includes(i) ? "weekday active" : "weekday"}
                  onClick={() => toggleWeekday(i)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {value.frequency === "monthly" && (
            <label>
              On day
              <input
                type="number"
                min={1}
                max={31}
                value={value.byMonthday}
                onChange={(e) => set("byMonthday", e.target.value)}
                style={{ width: 50 }}
                placeholder="1-31"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
