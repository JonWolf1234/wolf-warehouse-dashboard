import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { getOpportunityDiagnostics, getWarehouseJobs } from "./src/current-rms.js";
import { mockJobs } from "./src/mock-data.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
      return callback(new Error("This website is not allowed to use the warehouse API."));
    },
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "X-Dashboard-Key"]
  })
);

function requireDashboardKey(req, res, next) {
  const configuredKey = process.env.DASHBOARD_ACCESS_KEY?.trim();
  if (!configuredKey) {
    return res.status(503).json({
      error: "Dashboard access has not been configured on the server."
    });
  }

  const suppliedKey = req.get("X-Dashboard-Key")?.trim();
  if (!suppliedKey || suppliedKey !== configuredKey) {
    return res.status(401).json({ error: "Incorrect warehouse dashboard passphrase." });
  }
  next();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange() {
  const from = new Date();
  from.setDate(from.getDate() - 1);
  const to = new Date();
  to.setDate(to.getDate() + 45);
  return { from: dateOnly(from), to: dateOnly(to) };
}

function rangeDays(from, to) {
  return Math.ceil((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000);
}

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) cache.delete(key);
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "wolf-warehouse-dashboard-api",
    mode: booleanEnv("USE_MOCK_DATA") ? "mock" : "current-rms",
    time: new Date().toISOString()
  });
});

app.get("/api/jobs", requireDashboardKey, async (req, res, next) => {
  try {
    const defaults = defaultRange();
    const from = validDate(req.query.from) ? req.query.from : defaults.from;
    const to = validDate(req.query.to) ? req.query.to : defaults.to;

    if (new Date(`${from}T00:00:00Z`) > new Date(`${to}T00:00:00Z`)) {
      return res.status(400).json({ error: "The From date must be before the To date." });
    }
    if (rangeDays(from, to) > 180) {
      return res.status(400).json({ error: "Choose a date range of 180 days or less." });
    }

    cleanExpiredCache();
    const cacheKey = `${from}:${to}:${booleanEnv("USE_MOCK_DATA")}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached.payload, cached: true });

    const jobs = booleanEnv("USE_MOCK_DATA")
      ? mockJobs()
      : await getWarehouseJobs({ fromDate: from, toDate: to });

    const payload = {
      updatedAt: new Date().toISOString(),
      from,
      to,
      jobs,
      cached: false,
      mode: booleanEnv("USE_MOCK_DATA") ? "mock" : "current-rms"
    };

    const ttl = Math.max(10, Number(process.env.CACHE_SECONDS || 55)) * 1000;
    cache.set(cacheKey, { payload, expiresAt: Date.now() + ttl });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/diagnostics/opportunity/:id", requireDashboardKey, async (req, res, next) => {
  try {
    if (!booleanEnv("ENABLE_DIAGNOSTICS")) {
      return res.status(404).json({ error: "Diagnostics are disabled." });
    }
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Opportunity ID must be numeric." });
    }
    const diagnostics = await getOpportunityDiagnostics(req.params.id);
    res.json(diagnostics);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "docs")));
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(path.join(__dirname, "docs", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  const status = Number(error.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error:
      status === 401
        ? "Current RMS rejected the API credentials. Check the subdomain and API key."
        : error.message || "The warehouse dashboard could not load its data."
  });
});

app.listen(port, () => {
  console.log(`Wolf Warehouse Dashboard running at http://localhost:${port}`);
});
