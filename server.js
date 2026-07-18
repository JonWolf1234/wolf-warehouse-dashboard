import "dotenv/config";

console.log(
  "ENV CHECK:",
  process.env.DASHBOARD_ACCESS_KEY
    ? "dashboard key loaded"
    : "dashboard key missing"
);

import path from "node:path";
import { fileURLToPath } from "node:url";

import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";


console.log("RUNNING SERVER FILE:");
console.log(import.meta.url);

import {
  getOpportunityDiagnostics,
  getOpportunityItemDiagnostics,
  getWarehouseItemDiagnostics,
  getWarehouseJobs
} from "./src/current-rms.js";

import {
  getRecentCurrentRmsWebhooks,
  recordCurrentRmsWebhook
} from "./src/current-rms-webhooks.js";

import multer from "multer";

import {
  findGitHubCertificates,
  uploadGitHubCertificate,
  listGitHubCertificates,
  getCertificateBuffers
} from "./src/github-certificates.js";

import {
  sendCertificateEmail
} from "./src/certificate-email.js";

import { mockJobs } from "./src/mock-data.js";
import { getPool, query } from "./src/database.js";
import {
  findUserByEmail,
  hashPassword,
  publicUser,
  requireAuthenticatedUser,
  requireRole,
  ROLE_NAMES,
  verifyPassword
} from "./src/auth.js";

const app = express();

const certificateUpload = multer({
  storage:
    multer.memoryStorage(),

  limits: {
    fileSize:
      10 * 1024 * 1024
  },

  fileFilter:
    (
      request,
      file,
      callback
    ) => {
      const isPdf =
        file.mimetype ===
          "application/pdf" ||
        String(file.originalname || "")
          .toLowerCase()
          .endsWith(".pdf");

      if (!isPdf) {
        return callback(
          new Error(
            "Only PDF files may be uploaded."
          )
        );
      }

      callback(null, true);
    }
});

const port = Number(
  process.env.PORT || 3000
);

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const cache = new Map();

function booleanEnv(
  name,
  fallback = false
) {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return (
    String(value).toLowerCase() ===
    "true"
  );
}

function allowedOrigins() {
  return String(
    process.env.ALLOWED_ORIGINS ||
      "http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,

    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

app.use(compression());

const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool: getPool(),
      tableName: "user_sessions",
      createTableIfMissing: true
    }),
    name: "wolf.staffhub",
    secret: process.env.SESSION_SECRET || "development-only-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000
    }
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins().includes(origin)
      ) {
        return callback(
          null,
          true
        );
      }

      return callback(
        new Error(
          "This website is not allowed to use the warehouse API."
        )
      );
    },

    methods: ["GET", "POST", "PATCH"],

    allowedHeaders: [
      "Content-Type",
      "X-Dashboard-Key"
    ]
  })
);

function requireDashboardKey(request, response, next) {
  return requireAuthenticatedUser(request, response, next);
}



function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(
      value
    ) &&
    !Number.isNaN(
      new Date(
        `${value}T00:00:00Z`
      ).getTime()
    )
  );
}

function dateOnly(date) {
  return date
    .toISOString()
    .slice(0, 10);
}

function defaultRange() {
  const from = new Date();
  from.setDate(
    from.getDate() - 1
  );

  const to = new Date();
  to.setDate(
    to.getDate() + 45
  );

  return {
    from: dateOnly(from),
    to: dateOnly(to)
  };
}

function rangeDays(
  from,
  to
) {
  return Math.ceil(
    (
      new Date(
        `${to}T00:00:00Z`
      ) -
      new Date(
        `${from}T00:00:00Z`
      )
    ) /
      86_400_000
  );
}

function cleanExpiredCache() {
  const now = Date.now();

  for (
    const [key, value]
    of cache.entries()
  ) {
    if (
      value.expiresAt <= now
    ) {
      cache.delete(key);
    }
  }
}

/* =========================================================
   AUTHENTICATION AND USERS
   ========================================================= */

app.get("/api/auth/me", (request, response) => {
  response.json({ user: request.session?.user || null });
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const email = String(request.body?.email || "").trim();
    const password = String(request.body?.password || "");

    if (!email || !password) {
      return response.status(400).json({ error: "Enter your email address and password." });
    }

    const user = await findUserByEmail(email);
    const valid = user && user.status === "active" && await verifyPassword(password, user.password_hash);

    if (!valid) {
      return response.status(401).json({ error: "The email address or password was not accepted." });
    }

    request.session.regenerate(async (sessionError) => {
      if (sessionError) return next(sessionError);

      request.session.user = publicUser(user);

      await query(
        "UPDATE users SET last_login_at = NOW() WHERE id = $1",
        [user.id]
      );

      await query(
        `INSERT INTO audit_logs (organisation_id, actor_user_id, action, entity_type, entity_id)
         VALUES ($1, $2, 'user.login', 'user', $2)`,
        [user.organisation_id, user.id]
      );

      response.json({ user: request.session.user });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuthenticatedUser, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error);
    response.clearCookie("wolf.staffhub");
    response.json({ ok: true });
  });
});

app.get("/api/admin/users", requireRole("admin"), async (request, response, next) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, employment_type, role, status,
              current_rms_member_id, current_rms_contact_id, breathe_employee_id,
              last_login_at, created_at
       FROM users
       WHERE organisation_id = $1
       ORDER BY full_name ASC`,
      [request.session.user.organisationId]
    );
    response.json({ users: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", requireRole("admin"), async (request, response, next) => {
  try {
    const fullName = String(request.body?.fullName || "").trim();
    const email = String(request.body?.email || "").trim().toLowerCase();
    const password = String(request.body?.password || "");
    const employmentType = String(request.body?.employmentType || "");
    const role = String(request.body?.role || "");

    if (!fullName || !email || password.length < 12) {
      return response.status(400).json({ error: "Name, email and a password of at least 12 characters are required." });
    }

    if (!["full_time", "freelancer"].includes(employmentType) || !ROLE_NAMES.includes(role)) {
      return response.status(400).json({ error: "Choose a valid employment type and role." });
    }

    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (
         organisation_id, email, full_name, password_hash,
         employment_type, role, status,
         current_rms_member_id, current_rms_contact_id, breathe_employee_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
       RETURNING id, email, full_name, employment_type, role, status`,
      [
        request.session.user.organisationId,
        email,
        fullName,
        passwordHash,
        employmentType,
        role,
        request.body?.currentRmsMemberId || null,
        request.body?.currentRmsContactId || null,
        request.body?.breatheEmployeeId || null
      ]
    );

    await query(
      `INSERT INTO audit_logs (organisation_id, actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'user.created', 'user', $3, $4::jsonb)`,
      [request.session.user.organisationId, request.session.user.id, result.rows[0].id, JSON.stringify({ email, role })]
    );

    response.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return response.status(409).json({ error: "An account already exists for that email address." });
    }
    next(error);
  }
});

app.patch("/api/admin/users/:id/status", requireRole("admin"), async (request, response, next) => {
  try {
    const status = String(request.body?.status || "");
    if (!["active", "suspended", "archived"].includes(status)) {
      return response.status(400).json({ error: "Choose a valid account status." });
    }

    const result = await query(
      `UPDATE users SET status = $1, updated_at = NOW()
       WHERE id = $2 AND organisation_id = $3
       RETURNING id, email, full_name, employment_type, role, status`,
      [status, request.params.id, request.session.user.organisationId]
    );

    if (!result.rows[0]) return response.status(404).json({ error: "User not found." });
    response.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  "/api/health",
  (request, response) => {
    response.json({
      ok: true,

      service:
        "wolf-warehouse-dashboard-api",

      mode:
        booleanEnv(
          "USE_MOCK_DATA"
        )
          ? "mock"
          : "current-rms",

      diagnosticsEnabled:
        booleanEnv(
          "ENABLE_DIAGNOSTICS"
        ),

      time:
        new Date()
          .toISOString()
    });
  }
);

/* =========================================================
   JOB LIST
   ========================================================= */

app.get(
  "/api/jobs",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      const defaults =
        defaultRange();

      const from =
        validDate(
          request.query.from
        )
          ? request.query.from
          : defaults.from;

      const to =
        validDate(
          request.query.to
        )
          ? request.query.to
          : defaults.to;

      if (
        new Date(
          `${from}T00:00:00Z`
        ) >
        new Date(
          `${to}T00:00:00Z`
        )
      ) {
        return response
          .status(400)
          .json({
            error:
              "The From date must be before the To date."
          });
      }

      if (
        rangeDays(
          from,
          to
        ) > 180
      ) {
        return response
          .status(400)
          .json({
            error:
              "Choose a date range of 180 days or less."
          });
      }

      cleanExpiredCache();

      const cacheKey =
        `${from}:${to}:` +
        `${booleanEnv(
          "USE_MOCK_DATA"
        )}`;

      const cached =
        cache.get(cacheKey);

      if (cached) {
        return response.json({
          ...cached.payload,
          cached: true
        });
      }

      const jobs =
        booleanEnv(
          "USE_MOCK_DATA"
        )
          ? mockJobs()
          : await getWarehouseJobs({
              fromDate: from,
              toDate: to
            });

      const payload = {
        updatedAt:
          new Date()
            .toISOString(),

        from,
        to,
        jobs,

        cached: false,

        mode:
          booleanEnv(
            "USE_MOCK_DATA"
          )
            ? "mock"
            : "current-rms"
      };

      const ttl =
        Math.max(
          0,
          Number(
            process.env
              .CACHE_SECONDS ||
              55
          )
        ) * 1000;

      if (ttl > 0) {
        cache.set(
          cacheKey,
          {
            payload,

            expiresAt:
              Date.now() + ttl
          }
        );
      }

      response.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   RAW OPPORTUNITY DIAGNOSTIC
   Example:
   /api/diagnostics/opportunity/3781
   ========================================================= */

app.get(
  "/api/diagnostics/opportunity/:id",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      if (
        !booleanEnv(
          "ENABLE_DIAGNOSTICS"
        )
      ) {
        return response
          .status(404)
          .json({
            error:
              "Diagnostics are disabled."
          });
      }

      if (
        !/^\d+$/.test(
          request.params.id
        )
      ) {
        return response
          .status(400)
          .json({
            error:
              "Opportunity ID must be numeric."
          });
      }

      const diagnostics =
        await getOpportunityDiagnostics(
          request.params.id
        );

      response.json(
        diagnostics
      );
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   OUTSTANDING ITEM DIAGNOSTIC
   Example:
   /api/diagnostics/outstanding/3781
   ========================================================= */

app.get(
  "/api/diagnostics/outstanding/:id",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      if (
        !booleanEnv(
          "ENABLE_DIAGNOSTICS"
        )
      ) {
        return response
          .status(404)
          .json({
            error:
              "Diagnostics are disabled."
          });
      }

      if (
        !/^\d+$/.test(
          request.params.id
        )
      ) {
        return response
          .status(400)
          .json({
            error:
              "Opportunity ID must be numeric."
          });
      }

      const diagnostics =
        await getWarehouseItemDiagnostics(
          request.params.id
        );

      response.json(
        diagnostics
      );
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/diagnostics/opportunity-item/:id",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      if (
        !booleanEnv(
          "ENABLE_DIAGNOSTICS"
        )
      ) {
        return response
          .status(404)
          .json({
            error:
              "Diagnostics are disabled."
          });
      }

      if (
        !/^\d+$/.test(
          request.params.id
        )
      ) {
        return response
          .status(400)
          .json({
            error:
              "Opportunity item ID must be numeric."
          });
      }

      const diagnostics =
        await getOpportunityItemDiagnostics(
          request.params.id
        );

      response.json(
        diagnostics
      );
    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   CURRENT RMS WEBHOOK RECEIVER
   ========================================================= */

app.post(
  "/api/webhooks/current-rms",
  async (
    request,
    response
  ) => {
    const configuredSecret =
      process.env
        .CURRENT_RMS_WEBHOOK_SECRET
        ?.trim();

    const suppliedSecret =
      String(
        request.query.secret ||
        request.get(
          "X-Webhook-Secret"
        ) ||
        ""
      ).trim();

    if (
      !configuredSecret ||
      suppliedSecret !== configuredSecret
    ) {
      return response
        .status(401)
        .json({
          error:
            "Invalid webhook secret."
        });
    }

    const event =
      recordCurrentRmsWebhook(
        request.body
      );

    return response
      .status(202)
      .json({
        accepted: true,

        opportunityId:
          event.opportunityId,

        actionType:
          event.actionType,

        possibleAssetCount:
          event.possibleAssets.length
      });
  }
);

/*
 * Temporary diagnostic endpoint.
 * Protected by the normal dashboard password.
 */
app.get(
  "/api/webhooks/current-rms/recent",
  requireDashboardKey,
  (
    request,
    response
  ) => {
    response.json({
      events:
        getRecentCurrentRmsWebhooks()
    });
  }
);


/* =========================================================
   DROPBOX CERTIFICATE SEARCH
   ========================================================= */

app.post(
  "/api/certificates/find",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      const assetNumbers =
        request.body?.assetNumbers;

      if (
        !Array.isArray(
          assetNumbers
        )
      ) {
        return response
          .status(400)
          .json({
            error:
              "assetNumbers must be an array."
          });
      }

      if (
        assetNumbers.length > 100
      ) {
        return response
          .status(400)
          .json({
            error:
              "A maximum of 100 asset numbers can be searched at once."
          });
      }

      const result =
  await findGitHubCertificates(
    assetNumbers
  );

      return response.json(
        result
      );
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/certificates/find",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      const assetNumbers =
        request.body?.assetNumbers;

      if (!Array.isArray(assetNumbers)) {
        return response
          .status(400)
          .json({
            error:
              "assetNumbers must be an array."
          });
      }

      if (assetNumbers.length > 100) {
        return response
          .status(400)
          .json({
            error:
              "A maximum of 100 asset numbers can be searched at once."
          });
      }

      const result =
        await findGitHubCertificates(
          assetNumbers
        );

      return response.json(result);
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/certificates/upload",
  requireDashboardKey,
  certificateUpload.single(
    "certificate"
  ),
  async (
    request,
    response,
    next
  ) => {
    try {
      if (!request.file) {
        return response
          .status(400)
          .json({
            error:
              "Choose a PDF certificate."
          });
      }

      const result =
        await uploadGitHubCertificate({
          assetNumber:
            request.body?.assetNumber,

          description:
            request.body?.description,

          pdfBuffer:
            request.file.buffer
        });

      return response
        .status(201)
        .json({
          uploaded: true,
          certificate: result
        });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/certificates/send",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      const recipient =
        String(
          request.body?.recipient || ""
        ).trim();

      const jobReference =
        String(
          request.body?.jobReference || ""
        ).trim();

      const assetNumbers =
        Array.isArray(
          request.body?.assetNumbers
        )
          ? [
              ...new Set(
                request.body.assetNumbers
                  .map((value) =>
                    String(value || "")
                      .trim()
                  )
                  .filter(Boolean)
              )
            ]
          : [];

      if (!recipient) {
        return response
          .status(400)
          .json({
            error:
              "Enter a recipient email address."
          });
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          recipient
        )
      ) {
        return response
          .status(400)
          .json({
            error:
              "Enter a valid recipient email address."
          });
      }

      if (!assetNumbers.length) {
        return response
          .status(400)
          .json({
            error:
              "Enter at least one motor serial number."
          });
      }

      if (assetNumbers.length > 100) {
        return response
          .status(400)
          .json({
            error:
              "A maximum of 100 certificates may be sent at once."
          });
      }

      const certificateData =
        await getCertificateBuffers(
          assetNumbers
        );

      const attachments =
        Array.isArray(
          certificateData.attachments
        )
          ? certificateData.attachments
          : [];

      const found =
        Array.isArray(
          certificateData.found
        )
          ? certificateData.found
          : [];

      const missing =
        Array.isArray(
          certificateData.missing
        )
          ? certificateData.missing
          : [];

      if (!attachments.length) {
        return response
          .status(400)
          .json({
            error:
              "No matching certificates were found.",
            missing
          });
      }

      const displayReference =
        jobReference ||
        "your equipment hire";

      await sendCertificateEmail({
  recipient,

  subject:
    `Motor certificates - ${displayReference}`,

  jobReference:
    displayReference,

  certificates:
    found,

  missing,

  text:
    [
      "Hi,",
      "",
      `Please find attached the motor certificates for ${displayReference}.`,
      "",
      ...found.map(
        (certificate) =>
          `${certificate.assetNumber} - ${certificate.filename}`
      ),
      "",
      missing.length
        ? `Certificates not located: ${missing.join(", ")}.`
        : "All requested certificates are attached.",
      "",
      "Kind regards,",
      "",
      process.env.SMTP_FROM_NAME ||
        "Wolf Event Services"
    ].join("\n"),

  attachments
});

      return response.json({
        sent: true,
        recipient,
        attached:
          attachments.length,
        found:
          found.map(
            (certificate) => ({
              assetNumber:
                certificate.assetNumber,
              filename:
                certificate.filename
            })
          ),
        missing
      });
    } catch (error) {
      console.error(
        "[Certificate email]",
        error
      );

      next(error);
    }
  }
);

app.post(
  "/api/certificates/send",
  requireDashboardKey,
  async (
    request,
    response,
    next
  ) => {
    try {
      const {
        recipient,
        assetNumbers,
        jobReference
      } = request.body || {};

      if (
        !recipient ||
        !Array.isArray(
          assetNumbers
        )
      ) {
        return response
          .status(400)
          .json({
            error:
              "recipient and assetNumbers are required."
          });
      }

      const {
        attachments,
        found,
        missing
      } =
        await getCertificateBuffers(
          assetNumbers
        );

      if (!attachments.length) {
        return response
          .status(400)
          .json({
            error:
              "No certificates were found."
          });
      }

      await sendCertificateEmail({
        recipient,

        subject:
          `Motor certificates - ${jobReference}`,

        text:
          [
            "Hi,",
            "",
            `Please find attached the motor certificates for ${jobReference}.`,
            "",
            missing.length
              ? `Missing certificates: ${missing.join(", ")}`
              : "All requested certificates are attached.",
            "",
            "Kind regards,",
            "",
            "Wolf Event Services"
          ].join("\n"),

        attachments
      });

      return response.json({
        sent: true,
        attached:
          found.length,
        missing
      });
    } catch (error) {
      next(error);
    }
  }
);

function requirePageUser(request, response, next) {
  if (!request.session?.user) return response.redirect("/login");
  next();
}

function requirePageRole(...roles) {
  return (request, response, next) => {
    if (!request.session?.user) return response.redirect("/login");
    if (!roles.includes(request.session.user.role)) return response.status(403).send("Access denied.");
    next();
  };
}

/* =========================================================
   STATIC DASHBOARD
   These routes must come after every API route.
   ========================================================= */

app.get("/login", (request, response) => {
  if (request.session?.user) return response.redirect("/");
  response.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/admin/users", requirePageRole("admin"), (request, response) => {
  response.sendFile(path.join(__dirname, "public", "admin-users.html"));
});

app.use(requirePageUser);
app.use(express.static(path.join(__dirname, "docs")));

app.use(
  (
    request,
    response,
    next
  ) => {
    if (
      request.method !== "GET"
    ) {
      return next();
    }

    /*
     * Do not send index.html for an unknown API route.
     * Return JSON instead, which makes API mistakes
     * much easier to diagnose.
     */
    if (
      request.path.startsWith(
        "/api/"
      )
    ) {
      return response
        .status(404)
        .json({
          error:
            "API route not found."
        });
    }

    response.sendFile(
      path.join(
        __dirname,
        "docs",
        "index.html"
      )
    );
  }
);

/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
  (
    error,
    request,
    response,
    next
  ) => {
    console.error(error);

    const status =
      Number(error.status) ||
      500;

    response
      .status(
        status >= 400 &&
        status < 600
          ? status
          : 500
      )
      .json({
        error:
  error.message ||
  "The warehouse dashboard could not load its data."
      });
  }
);

app.listen(
  port,
  () => {
    console.log(
      `Wolf Warehouse Dashboard running at http://localhost:${port}`
    );
  }
);