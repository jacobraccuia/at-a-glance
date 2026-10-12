import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import pg from "pg";
import { authRouter } from "./routes/auth.js";
import { bucketsRouter } from "./routes/buckets.js";
import { tasksRouter } from "./routes/tasks.js";
import { goalsRouter } from "./routes/goals.js";
import { statsRouter } from "./routes/stats.js";
import { branding } from "./config/branding.js";

const PgSessionStore = pgSession(session);

export function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";

  // Required for secure cookies to work correctly behind Railway's (or any)
  // TLS-terminating reverse proxy -- otherwise Express sees plain HTTP and
  // refuses to set a "secure" cookie even though the real connection is HTTPS.
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  // Sessions persist in Postgres (not in-memory) specifically so that
  // restarting the dev server (e.g. tsx watch picking up a file change)
  // doesn't log everyone out. Table is auto-created on first run.
  const sessionPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true }));
  app.use(express.json());
  app.use(
    session({
      store: new PgSessionStore({ pool: sessionPool, tableName: "session", createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET ?? "dev-only-insecure-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        // Web and API live on different subdomains in production, so the
        // cookie must be sent cross-site; "none" requires "secure" (HTTPS),
        // which Railway provides on every generated domain.
        sameSite: isProduction ? "none" : "lax",
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      },
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, app: branding.appName, assistant: branding.assistantName });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/buckets", bucketsRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/stats", statsRouter);

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp();
  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => {
    console.log(`${branding.appName} server listening on http://localhost:${port}`);
  });
}
