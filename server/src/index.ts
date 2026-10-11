import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import { authRouter } from "./routes/auth.js";
import { bucketsRouter } from "./routes/buckets.js";
import { tasksRouter } from "./routes/tasks.js";
import { goalsRouter } from "./routes/goals.js";
import { statsRouter } from "./routes/stats.js";
import { branding } from "./config/branding.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true }));
  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? "dev-only-insecure-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
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
