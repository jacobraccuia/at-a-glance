import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Bucket } from "../api/types";

export function BucketsPage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4C9F70");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Bucket[]>("/buckets?includeArchived=true")
      .then((b) => {
        setBuckets(b);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function createBucket(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post("/buckets", { name: name.trim(), color });
      setName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bucket");
    }
  }

  async function archive(b: Bucket) {
    await api.post(`/buckets/${b.id}/archive`);
    load();
  }
  async function unarchive(b: Bucket) {
    await api.post(`/buckets/${b.id}/unarchive`);
    load();
  }

  return (
    <div className="page">
      <h2 className="settings-subhead">Buckets</h2>
      <form onSubmit={createBucket} className="inline-create-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New bucket name" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <button type="submit">Add bucket</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul className="bucket-list">
        {buckets.map((b) => (
          <li key={b.id} className={b.archivedAt ? "archived" : ""}>
            <span className="bucket-dot" style={{ backgroundColor: b.color ?? "#ccc" }} />
            <span>{b.name}</span>
            {b.archivedAt ? (
              <button onClick={() => unarchive(b)}>Unarchive</button>
            ) : (
              <button onClick={() => archive(b)}>Archive</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
