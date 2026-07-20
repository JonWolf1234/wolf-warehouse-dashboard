import "dotenv/config";

console.log(
  "ENV CHECK:",
  process.env.DASHBOARD_ACCESS_KEY
    ? "dashboard key loaded"
    : "dashboard key missing"
);

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";


console.log("[Wolf Staff Hub] build: vacancy-rounds-badges-v2");

console.log("RUNNING SERVER FILE:");
console.log(import.meta.url);

import {
  getOpportunityItemDiagnostics,
  getWarehouseItemDiagnostics,
  getWarehouseJobs,
  getAvailableWork,
  validateAvailablePosition,
  getAllocationDiagnostic,
  allocateResourceToOpportunityItem,
  findMemberAssignmentConflicts,
  inspectCurrentRmsMember,
  probeOpportunityAllocations
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
  createCertificateTransport,
  sendCertificateEmail
} from "./src/certificate-email.js";

import { mockJobs } from "./src/mock-data.js";
import {
  getCacheStatus,
  getSyncSettings,
  readCachedJobs,
  readCachedOpenPositions,
  startCurrentRmsSyncScheduler,
  syncCurrentRmsCache,
  updateSyncSettings
} from "./src/current-rms-cache.js";

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

    methods: ["GET", "POST", "PATCH", "PUT"],

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


function appBaseUrl(request) {
  const configured =
    String(
      process.env.APP_BASE_URL || ""
    )
      .trim()
      .replace(/\/$/, "");

  if (configured) {
    return configured;
  }

  return `${request.protocol}://${request.get("host")}`;
}

function hashResetToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

async function revokeUserSessions(userId) {
  /*
   * connect-pg-simple stores the session payload in
   * user_sessions.sess as JSON. This removes every
   * session belonging to the selected Staff Hub user.
   */
  await query(
    `DELETE FROM user_sessions
     WHERE sess -> 'user' ->> 'id' = $1`,
    [String(userId)]
  );
}

async function sendPasswordResetEmail({
  recipient,
  fullName,
  resetUrl
}) {
  const transport =
    createCertificateTransport();

  const fromEmail =
    process.env.SMTP_FROM_EMAIL?.trim();

  const fromName =
    process.env.SMTP_FROM_NAME?.trim() ||
    "Wolf Event Services";

  if (!fromEmail) {
    const error =
      new Error(
        "Password reset email delivery is not fully configured."
      );

    error.status = 503;
    throw error;
  }

  const safeName =
    String(fullName || "there")
      .replace(/[<>&"']/g, "");

  await transport.sendMail({
    from: {
      name: fromName,
      address: fromEmail
    },
    replyTo:
      process.env.SMTP_REPLY_TO?.trim() ||
      undefined,
    to: recipient,
    subject:
      "Reset your Wolf Staff Hub password",
    text: [
      `Hi ${safeName},`,
      "",
      "A password reset was requested for your Wolf Staff Hub account.",
      "",
      `Use this secure link within 30 minutes: ${resetUrl}`,
      "",
      "If you did not request this, you can ignore this email.",
      "",
      "Kind regards,",
      fromName
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;background:#eef1ef;font-family:Helvetica,Arial,sans-serif;color:#132019;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td align="center" style="padding:34px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                  style="max-width:620px;border-radius:16px;overflow:hidden;background:#fff;border:1px solid #dfe4e1;">
                  <tr>
                    <td style="padding:26px 34px;background:#12271c;color:#fff;">
                      <div style="font-size:29px;letter-spacing:-.04em;">
                        <strong>WOLF</strong><span style="font-weight:300;"> Lighting</span>
                      </div>
                      <div style="width:72px;height:4px;margin-top:13px;border-radius:4px;background:#ef7b32;"></div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:34px;">
                      <div style="margin-bottom:8px;color:#14763c;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">
                        Account security
                      </div>
                      <h1 style="margin:0 0 16px;font-size:27px;letter-spacing:-.03em;">
                        Reset your password
                      </h1>
                      <p style="color:#3d4842;line-height:1.65;">Hi ${safeName},</p>
                      <p style="color:#3d4842;line-height:1.65;">
                        A password reset was requested for your Wolf Staff Hub account.
                        The link expires in 30 minutes and can only be used once.
                      </p>
                      <p style="margin:26px 0;">
                        <a href="${resetUrl}"
                          style="display:inline-block;padding:13px 18px;border-radius:10px;background:#e66d2e;color:#fff;text-decoration:none;font-weight:800;">
                          Reset password
                        </a>
                      </p>
                      <p style="margin:0;color:#69716d;font-size:13px;line-height:1.6;">
                        If you did not request this, no action is needed.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `
  });
}


function requireFreelancerApprover(
  request,
  response,
  next
) {
  const user =
    request.session?.user;

  if (!user) {
    return response.status(401).json({
      error: "Please sign in."
    });
  }

  if (
    user.role !== "admin" &&
    !user.canApproveFreelancers
  ) {
    return response.status(403).json({
      error:
        "You do not have permission to review freelancer applications."
    });
  }

  return next();
}

async function notifyFreelancerApprovers({
  organisationId,
  freelancerName,
  jobName,
  serviceName,
  startsAt
}) {
  const result =
    await query(
      `SELECT email
       FROM users
       WHERE
         organisation_id = $1
         AND status = 'active'
         AND (
           role = 'admin'
           OR can_approve_freelancers = TRUE
         )`,
      [organisationId]
    );

  const recipients =
    result.rows
      .map((row) => row.email)
      .filter(Boolean);

  if (!recipients.length) {
    return;
  }

  const transport =
    createCertificateTransport();

  await transport.sendMail({
    from: {
      name:
        process.env.SMTP_FROM_NAME?.trim() ||
        "Wolf Event Services",
      address:
        process.env.SMTP_FROM_EMAIL?.trim()
    },
    replyTo:
      process.env.SMTP_REPLY_TO?.trim() ||
      undefined,
    to: recipients.join(","),
    subject:
      `Freelancer available: ${jobName}`,
    text: [
      `${freelancerName} has marked themselves available.`,
      "",
      `Job: ${jobName}`,
      `Position: ${serviceName}`,
      `Starts: ${startsAt || "Not set"}`,
      "",
      `${process.env.APP_BASE_URL || "http://localhost:3000"}/freelancer-applications`
    ].join("\\n")
  });
}


async function sendFreelancerAllocationConfirmation({
  email,
  fullName,
  jobName,
  serviceName,
  startsAt,
  endsAt
}) {
  if (!email || !process.env.SMTP_FROM_EMAIL) {
    return;
  }

  const transport =
    createCertificateTransport();

  await transport.sendMail({
    from: {
      name:
        process.env.SMTP_FROM_NAME?.trim() ||
        "Wolf Event Services",
      address:
        process.env.SMTP_FROM_EMAIL.trim()
    },
    replyTo:
      process.env.SMTP_REPLY_TO?.trim() ||
      undefined,
    to: email,
    subject:
      `Confirmed: ${jobName}`,
    text: [
      `Hi ${fullName || "there"},`,
      "",
      "Your availability has been accepted and your assignment is now confirmed in Current RMS.",
      "",
      `Job: ${jobName}`,
      `Role: ${serviceName}`,
      `Call: ${startsAt || "To be confirmed"}`,
      `Finish: ${endsAt || "To be confirmed"}`,
      "",
      `${process.env.APP_BASE_URL || "http://localhost:3000"}/dashboard`,
      "",
      "Kind regards,",
      process.env.SMTP_FROM_NAME?.trim() ||
        "Wolf Event Services"
    ].join("\\n")
  });
}

/* =========================================================
   AUTHENTICATION AND USERS
   ========================================================= */


app.get(
  "/api/navigation-badges",
  requireAuthenticatedUser,
  async (request, response, next) => {
    try {
      const user =
        request.session.user;

      let availableWork = 0;
      let applications = 0;

      if (
        user.personType === "freelancer"
      ) {
        const published =
          await query(
            `SELECT
               opportunity_item_id,
               vacancy_round
             FROM available_work_publications
             WHERE
               organisation_id = $1
               AND status = 'published'
               AND (
                 application_deadline IS NULL
                 OR application_deadline > NOW()
               )`,
            [
              user.organisationId
            ]
          );

        const existing =
          await query(
            `SELECT
               opportunity_item_id,
               vacancy_round
             FROM freelancer_applications
             WHERE
               user_id = $1
               AND status IN (
                 'pending',
                 'accepted'
               )`,
            [
              user.id
            ]
          );

        const existingKeys =
          new Set(
            existing.rows.map(
              (row) =>
                [
                  row.opportunity_item_id,
                  row.vacancy_round || 1
                ].join(":")
            )
          );

        availableWork =
          published.rows.filter(
            (row) =>
              !existingKeys.has(
                [
                  row.opportunity_item_id,
                  row.vacancy_round || 1
                ].join(":")
              )
          ).length;
      }

      if (
        user.role === "admin" ||
        user.canApproveFreelancers
      ) {
        const result =
          await query(
            `SELECT
               COUNT(*)::integer AS count
             FROM freelancer_applications
             WHERE
               organisation_id = $1
               AND status = 'pending'`,
            [
              user.organisationId
            ]
          );

        applications =
          Number(
            result.rows[0]?.count || 0
          );
      }

      return response.json({
        availableWork,
        applications
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/api/auth/me", (request, response) => {
  response.json({ user: request.session?.user || null });
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const email = String(request.body?.email || "")
      .trim()
      .toLowerCase();

    const password = String(request.body?.password || "");

    if (!email || !password) {
      return response.status(400).json({
        error: "Enter your email address and password."
      });
    }

    const user = await findUserByEmail(email);

    const validPassword =
      user &&
      user.status === "active" &&
      await verifyPassword(
        password,
        user.password_hash
      );

    if (!validPassword) {
      return response.status(401).json({
        error:
          "The email address or password was not accepted."
      });
    }

    await new Promise((resolve, reject) => {
      request.session.regenerate((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    request.session.user = publicUser(user);

    await query(
      `UPDATE users
       SET last_login_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    await query(
      `INSERT INTO audit_logs (
         organisation_id,
         actor_user_id,
         action,
         entity_type,
         entity_id
       )
       VALUES ($1, $2, 'user.login', 'user', $3)`,
      [
        user.organisation_id,
        user.id,
        String(user.id)
      ]
    );

    await new Promise((resolve, reject) => {
      request.session.save((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return response.json({
      user: request.session.user
    });
  } catch (error) {
    console.error("Login failed:", error);
    return next(error);
  }
});


app.post(
  "/api/auth/change-password",
  requireAuthenticatedUser,
  async (request, response, next) => {
    try {
      const currentPassword =
        String(
          request.body?.currentPassword || ""
        );

      const newPassword =
        String(
          request.body?.newPassword || ""
        );

      const confirmPassword =
        String(
          request.body?.confirmPassword || ""
        );

      if (
        !currentPassword ||
        newPassword.length < 12
      ) {
        return response.status(400).json({
          error:
            "Enter your current password and a new password of at least 12 characters."
        });
      }

      if (newPassword !== confirmPassword) {
        return response.status(400).json({
          error:
            "The new passwords do not match."
        });
      }

      const result = await query(
        `SELECT
           id,
           organisation_id,
           password_hash
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [request.session.user.id]
      );

      const user =
        result.rows[0];

      const valid =
        user &&
        await verifyPassword(
          currentPassword,
          user.password_hash
        );

      if (!valid) {
        return response.status(401).json({
          error:
            "Your current password was not accepted."
        });
      }

      const reused =
        await verifyPassword(
          newPassword,
          user.password_hash
        );

      if (reused) {
        return response.status(400).json({
          error:
            "Choose a password you have not just been using."
        });
      }

      const passwordHash =
        await hashPassword(newPassword);

      await query(
        `UPDATE users
         SET
           password_hash = $1,
           updated_at = NOW()
         WHERE id = $2`,
        [
          passwordHash,
          user.id
        ]
      );

      await query(
        `DELETE FROM password_reset_tokens
         WHERE user_id = $1`,
        [user.id]
      );

      await query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id
         )
         VALUES (
           $1,
           $2,
           'user.password_changed',
           'user',
           $3
         )`,
        [
          user.organisation_id,
          user.id,
          String(user.id)
        ]
      );

      await revokeUserSessions(
        user.id
      );

      request.session.destroy(
        (error) => {
          if (error) {
            return next(error);
          }

          response.clearCookie(
            "wolf.staffhub"
          );

          return response.json({
            ok: true,
            signedOut: true
          });
        }
      );
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/auth/forgot-password",
  async (request, response, next) => {
    const genericResponse = {
      ok: true,
      message:
        "If an active account matches that email address, a reset link has been sent."
    };

    try {
      const email =
        String(
          request.body?.email || ""
        )
          .trim()
          .toLowerCase();

      if (!email) {
        return response.json(
          genericResponse
        );
      }

      const user =
        await findUserByEmail(email);

      if (
        !user ||
        user.status !== "active"
      ) {
        return response.json(
          genericResponse
        );
      }

      const token =
        crypto.randomBytes(32)
          .toString("hex");

      const tokenHash =
        hashResetToken(token);

      await query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE
           user_id = $1
           AND used_at IS NULL`,
        [user.id]
      );

      await query(
        `INSERT INTO password_reset_tokens (
           user_id,
           token_hash,
           expires_at
         )
         VALUES (
           $1,
           $2,
           NOW() + INTERVAL '30 minutes'
         )`,
        [
          user.id,
          tokenHash
        ]
      );

      const resetUrl =
        `${appBaseUrl(request)}` +
        `/reset-password?token=${encodeURIComponent(token)}`;

      try {
        await sendPasswordResetEmail({
          recipient: user.email,
          fullName: user.full_name,
          resetUrl
        });

        await query(
          `INSERT INTO audit_logs (
             organisation_id,
             actor_user_id,
             action,
             entity_type,
             entity_id
           )
           VALUES (
             $1,
             $2,
             'user.password_reset_requested',
             'user',
             $3
           )`,
          [
            user.organisation_id,
            user.id,
            String(user.id)
          ]
        );
      } catch (emailError) {
        console.error(
          "Password reset email failed:",
          emailError
        );
      }

      return response.json(
        genericResponse
      );
    } catch (error) {
      console.error(
        "Forgot-password request failed:",
        error
      );

      /*
       * Keep the response generic even when something
       * goes wrong so account existence is not leaked.
       */
      return response.json(
        genericResponse
      );
    }
  }
);

app.get(
  "/api/auth/reset-password/validate",
  async (request, response, next) => {
    try {
      const token =
        String(
          request.query.token || ""
        ).trim();

      if (!token) {
        return response.status(400).json({
          valid: false,
          error:
            "This reset link is invalid or has expired."
        });
      }

      const tokenHash =
        hashResetToken(token);

      const result = await query(
        `SELECT id
         FROM password_reset_tokens
         WHERE
           token_hash = $1
           AND used_at IS NULL
           AND expires_at > NOW()
         LIMIT 1`,
        [tokenHash]
      );

      if (!result.rows[0]) {
        return response.status(400).json({
          valid: false,
          error:
            "This reset link is invalid or has expired."
        });
      }

      return response.json({
        valid: true
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/auth/reset-password",
  async (request, response, next) => {
    const client =
      await getPool().connect();

    try {
      const token =
        String(
          request.body?.token || ""
        ).trim();

      const newPassword =
        String(
          request.body?.newPassword || ""
        );

      const confirmPassword =
        String(
          request.body?.confirmPassword || ""
        );

      if (
        !token ||
        newPassword.length < 12
      ) {
        return response.status(400).json({
          error:
            "Enter a new password of at least 12 characters."
        });
      }

      if (newPassword !== confirmPassword) {
        return response.status(400).json({
          error:
            "The new passwords do not match."
        });
      }

      const tokenHash =
        hashResetToken(token);

      await client.query("BEGIN");

      const tokenResult =
        await client.query(
          `SELECT
             prt.id,
             prt.user_id,
             u.organisation_id
           FROM password_reset_tokens prt
           JOIN users u
             ON u.id = prt.user_id
           WHERE
             prt.token_hash = $1
             AND prt.used_at IS NULL
             AND prt.expires_at > NOW()
             AND u.status = 'active'
           FOR UPDATE
           LIMIT 1`,
          [tokenHash]
        );

      const reset =
        tokenResult.rows[0];

      if (!reset) {
        await client.query("ROLLBACK");

        return response.status(400).json({
          error:
            "This reset link is invalid or has expired."
        });
      }

      const passwordHash =
        await hashPassword(newPassword);

      await client.query(
        `UPDATE users
         SET
           password_hash = $1,
           updated_at = NOW()
         WHERE id = $2`,
        [
          passwordHash,
          reset.user_id
        ]
      );

      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE user_id = $1
           AND used_at IS NULL`,
        [reset.user_id]
      );

      await client.query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id
         )
         VALUES (
           $1,
           $2,
           'user.password_reset_completed',
           'user',
           $3
         )`,
        [
          reset.organisation_id,
          reset.user_id,
          String(reset.user_id)
        ]
      );

      await client.query("COMMIT");

      await revokeUserSessions(
        reset.user_id
      );

      return response.json({
        ok: true
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      return next(error);
    } finally {
      client.release();
    }
  }
);

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
              person_type, current_rms_record_type, current_rms_record_id,
              current_rms_member_id, current_rms_contact_id, can_open_current_rms,
              can_approve_freelancers, suitable_service_ids, breathe_employee_id,
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
    const personType = String(request.body?.personType || (employmentType === "freelancer" ? "freelancer" : "staff"));
    const currentRmsRecordType = String(request.body?.currentRmsRecordType || (request.body?.currentRmsMemberId ? "member" : request.body?.currentRmsContactId ? "contact" : "none"));
    const currentRmsRecordId = String(request.body?.currentRmsRecordId || request.body?.currentRmsMemberId || request.body?.currentRmsContactId || "").trim() || null;
    const canOpenCurrentRms = request.body?.canOpenCurrentRms === true;
    const canApproveFreelancers = request.body?.canApproveFreelancers === true;
    const suitableServiceIds = String(request.body?.suitableServiceIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\\d+$/.test(value));
    const role = String(request.body?.role || "");

    if (!fullName || !email || password.length < 12) {
      return response.status(400).json({ error: "Name, email and a password of at least 12 characters are required." });
    }

    if (!["full_time", "freelancer"].includes(employmentType) || !["staff", "freelancer"].includes(personType) || !["member", "contact", "none"].includes(currentRmsRecordType) || !ROLE_NAMES.includes(role)) {
      return response.status(400).json({ error: "Choose a valid employment type and role." });
    }

    const passwordHash = await hashPassword(password);
    const result = await query(
  `INSERT INTO users (
     organisation_id,
     email,
     full_name,
     password_hash,
     employment_type,
     person_type,
     role,
     status,
     current_rms_record_type,
     current_rms_record_id,
     current_rms_member_id,
     current_rms_contact_id,
     breathe_employee_id,
     can_open_current_rms,
     can_approve_freelancers,
     suitable_service_ids
   )
   VALUES (
     $1,
     $2,
     $3,
     $4,
     $5,
     $6,
     $7,
     'active',
     $8,
     $9,
     $10,
     $11,
     $12,
     $13,
     $14,
     $15
   )
   RETURNING
     id,
     email,
     full_name,
     employment_type,
     person_type,
     role,
     status,
     can_open_current_rms,
     can_approve_freelancers,
     suitable_service_ids`,
  [
    request.session.user.organisationId,
    email,
    fullName,
    passwordHash,
    employmentType,
    personType,
    role,
    currentRmsRecordType,
    currentRmsRecordId,
    currentRmsRecordType === "member"
      ? currentRmsRecordId
      : null,
    currentRmsRecordType === "contact"
      ? currentRmsRecordId
      : null,
    request.body?.breatheEmployeeId || null,
    canOpenCurrentRms,
    canApproveFreelancers,
    suitableServiceIds
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
       RETURNING id, email, full_name, employment_type, person_type, role, status`,
      [status, request.params.id, request.session.user.organisationId]
    );

    if (!result.rows[0]) return response.status(404).json({ error: "User not found." });
    response.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/api/admin/users/:id/current-rms-access",
  requireRole("admin"),
  async (
    request,
    response,
    next
  ) => {
    try {
      const canOpenCurrentRms =
        request.body
          ?.canOpenCurrentRms ===
        true;

      const result =
        await query(
          `UPDATE users
           SET
             can_open_current_rms = $1,
             updated_at = NOW()
           WHERE
             id = $2
             AND organisation_id = $3
           RETURNING
             id,
             email,
             full_name,
             can_open_current_rms`,
          [
            canOpenCurrentRms,
            request.params.id,
            request.session.user
              .organisationId
          ]
        );

      if (!result.rows[0]) {
        return response
          .status(404)
          .json({
            error:
              "User not found."
          });
      }

      await query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,
           $2,
           'user.current_rms_access_changed',
           'user',
           $3,
           $4::jsonb
         )`,
        [
          request.session.user
            .organisationId,

          request.session.user.id,

          result.rows[0].id,

          JSON.stringify({
            canOpenCurrentRms
          })
        ]
      );

      return response.json({
        user:
          result.rows[0]
      });
    } catch (error) {
      return next(error);
    }
  }
);


app.patch(
  "/api/admin/users/:id",
  requireRole("admin"),
  async (request, response, next) => {
    try {
      const fullName = String(request.body?.fullName || "").trim();
      const email = String(request.body?.email || "").trim().toLowerCase();
      const employmentType = String(request.body?.employmentType || "");
      const personType = String(request.body?.personType || "");
      const role = String(request.body?.role || "");
      const status = String(request.body?.status || "");
      const currentRmsRecordType = String(
        request.body?.currentRmsRecordType || "none"
      );
      const currentRmsRecordId =
        String(request.body?.currentRmsRecordId || "").trim() || null;
      const breatheEmployeeId =
        String(request.body?.breatheEmployeeId || "").trim() || null;
      const canOpenCurrentRms =
        request.body?.canOpenCurrentRms === true;

      const canApproveFreelancers =
        request.body?.canApproveFreelancers === true;

      const suitableServiceIds =
        String(request.body?.suitableServiceIds || "")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => /^\\d+$/.test(value));

      if (!fullName || !email) {
        return response.status(400).json({
          error: "Name and email are required."
        });
      }

      if (
        !["full_time", "freelancer"].includes(employmentType) ||
        !["staff", "freelancer"].includes(personType) ||
        !ROLE_NAMES.includes(role) ||
        !["active", "suspended", "archived"].includes(status) ||
        !["member", "contact", "none"].includes(currentRmsRecordType)
      ) {
        return response.status(400).json({
          error: "Choose valid user settings."
        });
      }

      if (
        currentRmsRecordType !== "none" &&
        (!currentRmsRecordId || !/^\d+$/.test(currentRmsRecordId))
      ) {
        return response.status(400).json({
          error: "Enter a numeric Current RMS record ID."
        });
      }

      const existing = await query(
        `SELECT
           id, email, full_name, employment_type, person_type,
           role, status, current_rms_record_type,
           current_rms_record_id, breathe_employee_id,
           can_open_current_rms,
           can_approve_freelancers,
           suitable_service_ids
         FROM users
         WHERE id = $1 AND organisation_id = $2
         LIMIT 1`,
        [
          request.params.id,
          request.session.user.organisationId
        ]
      );

      if (!existing.rows[0]) {
        return response.status(404).json({
          error: "User not found."
        });
      }

      const result = await query(
        `UPDATE users
         SET
           full_name = $1,
           email = $2,
           employment_type = $3,
           person_type = $4,
           role = $5,
           status = $6,
           current_rms_record_type = $7,
           current_rms_record_id = $8,
           current_rms_member_id = $9,
           current_rms_contact_id = $10,
           breathe_employee_id = $11,
           can_open_current_rms = $12,
           can_approve_freelancers = $13,
           suitable_service_ids = $14,
           updated_at = NOW()
         WHERE id = $15 AND organisation_id = $16
         RETURNING
           id, email, full_name, employment_type, person_type,
           role, status, current_rms_record_type,
           current_rms_record_id, current_rms_member_id,
           current_rms_contact_id, breathe_employee_id,
           can_open_current_rms,
           can_approve_freelancers,
           suitable_service_ids,
           last_login_at, created_at`,
        [
          fullName,
          email,
          employmentType,
          personType,
          role,
          status,
          currentRmsRecordType,
          currentRmsRecordType === "none" ? null : currentRmsRecordId,
          currentRmsRecordType === "member" ? currentRmsRecordId : null,
          currentRmsRecordType === "contact" ? currentRmsRecordId : null,
          breatheEmployeeId,
          canOpenCurrentRms,
          canApproveFreelancers,
          suitableServiceIds,
          request.params.id,
          request.session.user.organisationId
        ]
      );

      const before = existing.rows[0];
      const after = result.rows[0];
      const fields = [
        "email",
        "full_name",
        "employment_type",
        "person_type",
        "role",
        "status",
        "current_rms_record_type",
        "current_rms_record_id",
        "breathe_employee_id",
        "can_open_current_rms",
        "can_approve_freelancers",
        "suitable_service_ids"
      ];

      const changes = fields.filter(
        (field) =>
          String(before[field] ?? "") !==
          String(after[field] ?? "")
      );

      await query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,
           $2,
           'user.updated',
           'user',
           $3,
           $4::jsonb
         )`,
        [
          request.session.user.organisationId,
          request.session.user.id,
          after.id,
          JSON.stringify({ changes })
        ]
      );

      if (
        String(request.session.user.id) ===
        String(after.id)
      ) {
        const refreshed =
          await findUserByEmail(after.email);

        request.session.user =
          publicUser(refreshed);

        await new Promise((resolve, reject) => {
          request.session.save((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }

      return response.json({
        user: after
      });
    } catch (error) {
      if (error.code === "23505") {
        return response.status(409).json({
          error:
            "An account already exists for that email address."
        });
      }

      return next(error);
    }
  }
);





app.get(
  "/api/open-work-admin",
  requireFreelancerApprover,
  async (request, response, next) => {
    try {
      const defaults =
        defaultRange();

      const cachedPositions =
        await readCachedOpenPositions(
          request.session.user.organisationId
        );

      const positions =
        cachedPositions.positions;

      const freelancers =
        await query(
          `SELECT
             id,
             full_name,
             email,
             suitable_service_ids,
             current_rms_record_type,
             current_rms_record_id
           FROM users
           WHERE
             organisation_id = $1
             AND status = 'active'
             AND person_type = 'freelancer'
           ORDER BY full_name ASC`,
          [
            request.session.user
              .organisationId
          ]
        );

      const publications =
        await query(
          `SELECT *
           FROM available_work_publications
           WHERE organisation_id = $1`,
          [
            request.session.user
              .organisationId
          ]
        );

      const publicationIds =
        publications.rows.map(
          (publication) =>
            publication.id
        );

      let exclusions = [];
      let inclusions = [];

      if (publicationIds.length) {
        const exclusionResult =
          await query(
            `SELECT publication_id, user_id
             FROM available_work_exclusions
             WHERE publication_id = ANY($1::uuid[])`,
            [publicationIds]
          );

        const inclusionResult =
          await query(
            `SELECT publication_id, user_id
             FROM available_work_inclusions
             WHERE publication_id = ANY($1::uuid[])`,
            [publicationIds]
          );

        exclusions =
          exclusionResult.rows;

        inclusions =
          inclusionResult.rows;
      }

      const publicationByItem =
        new Map(
          publications.rows.map(
            (publication) => [
              String(
                publication.opportunity_item_id
              ),
              {
                ...publication,

                excludedUserIds:
                  exclusions
                    .filter(
                      (item) =>
                        String(
                          item.publication_id
                        ) ===
                        String(
                          publication.id
                        )
                    )
                    .map(
                      (item) =>
                        String(item.user_id)
                    ),

                includedUserIds:
                  inclusions
                    .filter(
                      (item) =>
                        String(
                          item.publication_id
                        ) ===
                        String(
                          publication.id
                        )
                    )
                    .map(
                      (item) =>
                        String(item.user_id)
                    )
              }
            ]
          )
        );

      const currentItemIds =
        new Set(
          positions.map(
            (position) =>
              String(
                position.opportunityItemId
              )
          )
        );

      /*
       * Reconcile publication state with Current RMS:
       *
       * - Filled/removed vacancies are automatically closed.
       * - If that vacancy later returns, an automatically closed
       *   publication returns to draft for an approver to review.
       * - Manually closed positions remain closed.
       */
      for (const publication of publications.rows) {
        const itemIsOpen =
          currentItemIds.has(
            String(
              publication.opportunity_item_id
            )
          );

        if (
          ["published", "draft"].includes(
            publication.status
          ) &&
          !itemIsOpen
        ) {
          const result =
            await query(
              `UPDATE available_work_publications
               SET
                 status = 'closed',
                 auto_closed = TRUE,
                 updated_at = NOW()
               WHERE id = $1
               RETURNING *`,
              [publication.id]
            );

          Object.assign(
            publication,
            result.rows[0] || {
              status: "closed",
              auto_closed: true
            }
          );

          continue;
        }

        if (
          publication.status === "closed" &&
          itemIsOpen &&
          (
            publication.auto_closed === true ||
            publication.published_at
          )
        ) {
          const previousRound =
            Number(
              publication.vacancy_round || 1
            );

          const previousAssignee =
            await query(
              `SELECT
                 u.full_name
               FROM freelancer_applications fa
               JOIN users u
                 ON u.id = fa.user_id
               WHERE
                 fa.organisation_id = $1
                 AND fa.opportunity_item_id = $2
                 AND fa.vacancy_round = $3
                 AND fa.status = 'accepted'
               ORDER BY
                 fa.reviewed_at DESC NULLS LAST,
                 fa.updated_at DESC
               LIMIT 1`,
              [
                request.session.user
                  .organisationId,
                publication
                  .opportunity_item_id,
                previousRound
              ]
            );

          await query(
            `UPDATE freelancer_applications
             SET
               status = 'historical',
               historical_at = NOW(),
               returned_at = NOW(),
               updated_at = NOW()
             WHERE
               organisation_id = $1
               AND opportunity_item_id = $2
               AND vacancy_round = $3
               AND status IN (
                 'pending',
                 'accepted',
                 'declined'
               )`,
            [
              request.session.user
                .organisationId,
              publication
                .opportunity_item_id,
              previousRound
            ]
          );

          const result =
            await query(
              `UPDATE available_work_publications
               SET
                 status = 'draft',
                 auto_closed = FALSE,
                 vacancy_round = $1,
                 previous_assignee_name = $2,
                 returned_at = NOW(),
                 unpublished_at = NOW(),
                 updated_at = NOW()
               WHERE id = $3
               RETURNING *`,
              [
                previousRound + 1,
                previousAssignee.rows[0]
                  ?.full_name || null,
                publication.id
              ]
            );

          Object.assign(
            publication,
            result.rows[0] || {
              status: "draft",
              auto_closed: false,
              vacancy_round:
                previousRound + 1
            }
          );
        }
      }

      const openPositions =
        positions.map(
          (position) => ({
            ...position,
            publication:
              publicationByItem.get(
                String(
                  position.opportunityItemId
                )
              ) || null
          })
        );

      const historical =
        publications.rows
          .filter(
            (publication) =>
              !currentItemIds.has(
                String(
                  publication.opportunity_item_id
                )
              )
          )
          .map(
            (publication) => ({
              opportunityId:
                publication.opportunity_id,
              opportunityItemId:
                publication.opportunity_item_id,
              serviceId:
                publication.service_id,
              reference:
                publication.job_reference,
              name:
                publication.job_name,
              customer:
                publication.customer_name,
              serviceName:
                publication.service_name,
              startsAt:
                publication.starts_at,
              endsAt:
                publication.ends_at,
              required:
                publication.required_quantity,
              allocated:
                publication.allocated_quantity,
              openPositions:
                publication.open_positions,
              publication:
                publicationByItem.get(
                  String(
                    publication.opportunity_item_id
                  )
                ) || publication
            })
          );

      const applicationCounts =
        await query(
          `SELECT
             opportunity_item_id,
             COUNT(*) FILTER (
               WHERE status = 'pending'
             ) AS pending_count,
             COUNT(*) FILTER (
               WHERE status = 'accepted'
             ) AS accepted_count
           FROM freelancer_applications
           WHERE organisation_id = $1
           GROUP BY opportunity_item_id`,
          [
            request.session.user
              .organisationId
          ]
        );

      const countsByItem =
        new Map(
          applicationCounts.rows.map(
            (row) => [
              String(
                row.opportunity_item_id
              ),
              {
                pending:
                  Number(
                    row.pending_count || 0
                  ),
                accepted:
                  Number(
                    row.accepted_count || 0
                  )
              }
            ]
          )
        );

      const combinedPositions = [
        ...openPositions,
        ...historical
      ].map(
        (position) => ({
          ...position,
          applicationCounts:
            countsByItem.get(
              String(
                position.opportunityItemId
              )
            ) || {
              pending: 0,
              accepted: 0
            }
        })
      );

      return response.json({
        positions:
          combinedPositions,
        freelancers:
          freelancers.rows
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.put(
  "/api/open-work-admin/:opportunityItemId/publication",
  requireFreelancerApprover,
  async (request, response, next) => {
    const client =
      await getPool().connect();

    try {
      const status =
        String(
          request.body?.status ||
          "draft"
        );

      const audienceMode =
        String(
          request.body?.audienceMode ||
          "all_suitable"
        );

      if (
        ![
          "draft",
          "published",
          "ignored",
          "closed"
        ].includes(status)
      ) {
        return response.status(400).json({
          error:
            "Choose a valid publication status."
        });
      }

      if (
        ![
          "all_suitable",
          "selected"
        ].includes(audienceMode)
      ) {
        return response.status(400).json({
          error:
            "Choose a valid audience."
        });
      }

      const cachedPositions =
        await readCachedOpenPositions(
          request.session.user.organisationId
        );

      const positions =
        cachedPositions.positions;

      const position =
        positions.find(
          (item) =>
            String(
              item.opportunityItemId
            ) ===
            String(
              request.params.opportunityItemId
            )
        );

      const existing =
        await query(
          `SELECT *
           FROM available_work_publications
           WHERE
             organisation_id = $1
             AND opportunity_item_id = $2
           LIMIT 1`,
          [
            request.session.user
              .organisationId,
            request.params
              .opportunityItemId
          ]
        );

      if (
        !position &&
        !existing.rows[0]
      ) {
        return response.status(404).json({
          error:
            "Open position not found."
        });
      }

      const source =
        position || {
          opportunityId:
            existing.rows[0]
              .opportunity_id,
          opportunityItemId:
            existing.rows[0]
              .opportunity_item_id,
          serviceId:
            existing.rows[0]
              .service_id,
          reference:
            existing.rows[0]
              .job_reference,
          name:
            existing.rows[0]
              .job_name,
          customer:
            existing.rows[0]
              .customer_name,
          serviceName:
            existing.rows[0]
              .service_name,
          startsAt:
            existing.rows[0]
              .starts_at,
          endsAt:
            existing.rows[0]
              .ends_at,
          required:
            existing.rows[0]
              .required_quantity,
          allocated:
            existing.rows[0]
              .allocated_quantity,
          openPositions:
            existing.rows[0]
              .open_positions
        };

      const excludedUserIds =
        Array.isArray(
          request.body?.excludedUserIds
        )
          ? request.body
              .excludedUserIds
              .map(String)
          : [];

      const includedUserIds =
        Array.isArray(
          request.body?.includedUserIds
        )
          ? request.body
              .includedUserIds
              .map(String)
          : [];

      const deadline =
        String(
          request.body
            ?.applicationDeadline ||
          ""
        ).trim() || null;

      await client.query("BEGIN");

      const publicationResult =
        await client.query(
          `INSERT INTO available_work_publications (
             organisation_id,
             opportunity_id,
             opportunity_item_id,
             service_id,
             job_reference,
             job_name,
             customer_name,
             service_name,
             starts_at,
             ends_at,
             required_quantity,
             allocated_quantity,
             open_positions,
             status,
             audience_mode,
             application_deadline,
             freelancer_note,
             admin_note,
             published_by_user_id,
             published_at,
             unpublished_at,
             auto_closed
           )
           VALUES (
             $1,$2,$3,$4,$5,$6,$7,
             $8,$9,$10,$11,$12,$13,
             $14,$15,$16,$17,$18,$19,
             CASE
               WHEN $14 = 'published'
               THEN NOW()
               ELSE NULL
             END,
             CASE
               WHEN $14 <> 'published'
               THEN NOW()
               ELSE NULL
             END,
             FALSE
           )
           ON CONFLICT (
             organisation_id,
             opportunity_item_id
           )
           DO UPDATE SET
             opportunity_id =
               EXCLUDED.opportunity_id,
             service_id =
               EXCLUDED.service_id,
             job_reference =
               EXCLUDED.job_reference,
             job_name =
               EXCLUDED.job_name,
             customer_name =
               EXCLUDED.customer_name,
             service_name =
               EXCLUDED.service_name,
             starts_at =
               EXCLUDED.starts_at,
             ends_at =
               EXCLUDED.ends_at,
             required_quantity =
               EXCLUDED.required_quantity,
             allocated_quantity =
               EXCLUDED.allocated_quantity,
             open_positions =
               EXCLUDED.open_positions,
             status =
               EXCLUDED.status,
             audience_mode =
               EXCLUDED.audience_mode,
             application_deadline =
               EXCLUDED.application_deadline,
             freelancer_note =
               EXCLUDED.freelancer_note,
             admin_note =
               EXCLUDED.admin_note,
             published_by_user_id =
               EXCLUDED.published_by_user_id,
             published_at =
               CASE
                 WHEN
                   EXCLUDED.status =
                   'published'
                 THEN
                   COALESCE(
                     available_work_publications
                       .published_at,
                     NOW()
                   )
                 ELSE
                   available_work_publications
                     .published_at
               END,
             unpublished_at =
               CASE
                 WHEN
                   EXCLUDED.status <>
                   'published'
                 THEN NOW()
                 ELSE NULL
               END,
             auto_closed = FALSE,
             updated_at = NOW()
           RETURNING *`,
          [
            request.session.user
              .organisationId,
            source.opportunityId,
            source.opportunityItemId,
            source.serviceId || null,
            source.reference || null,
            source.name,
            source.customer || null,
            source.serviceName,
            source.startsAt,
            source.endsAt,
            Number(source.required || 0),
            Number(source.allocated || 0),
            Number(
              source.openPositions || 0
            ),
            status,
            audienceMode,
            deadline,
            String(
              request.body
                ?.freelancerNote || ""
            ).trim() || null,
            String(
              request.body
                ?.adminNote || ""
            ).trim() || null,
            request.session.user.id
          ]
        );

      const publication =
        publicationResult.rows[0];

      await client.query(
        `DELETE FROM available_work_exclusions
         WHERE publication_id = $1`,
        [publication.id]
      );

      await client.query(
        `DELETE FROM available_work_inclusions
         WHERE publication_id = $1`,
        [publication.id]
      );

      for (const userId of excludedUserIds) {
        await client.query(
          `INSERT INTO available_work_exclusions (
             publication_id,
             user_id,
             created_by_user_id
           )
           VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [
            publication.id,
            userId,
            request.session.user.id
          ]
        );
      }

      for (const userId of includedUserIds) {
        await client.query(
          `INSERT INTO available_work_inclusions (
             publication_id,
             user_id,
             created_by_user_id
           )
           VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [
            publication.id,
            userId,
            request.session.user.id
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,$2,
           'available_work.publication_updated',
           'available_work_publication',
           $3,
           $4::jsonb
         )`,
        [
          request.session.user
            .organisationId,
          request.session.user.id,
          publication.id,
          JSON.stringify({
            opportunityItemId:
              source.opportunityItemId,
            status,
            audienceMode,
            excludedUserIds,
            includedUserIds
          })
        ]
      );

      await client.query("COMMIT");

      return response.json({
        publication: {
          ...publication,
          excludedUserIds,
          includedUserIds
        }
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      return next(error);
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/available-work",
  requireAuthenticatedUser,
  async (request, response, next) => {
    try {
      const user =
        request.session.user;

      if (
        user.personType !== "freelancer"
      ) {
        return response.status(403).json({
          error:
            "Available Work is for freelancer accounts."
        });
      }

      const defaults =
        defaultRange();

      const cachedWork =
        await readCachedOpenPositions(
          user.organisationId,
          {
            suitableServiceIds:
              user.suitableServiceIds || [],
            excludeRecordId:
              user.currentRmsRecordType === "member"
                ? user.currentRmsRecordId
                : null
          }
        );

      const work =
        cachedWork.positions;

      const publications =
        await query(
          `SELECT
             awp.*,
             EXISTS (
               SELECT 1
               FROM available_work_exclusions awe
               WHERE
                 awe.publication_id = awp.id
                 AND awe.user_id = $2
             ) AS is_excluded,
             EXISTS (
               SELECT 1
               FROM available_work_inclusions awi
               WHERE
                 awi.publication_id = awp.id
                 AND awi.user_id = $2
             ) AS is_included
           FROM available_work_publications awp
           WHERE
             awp.organisation_id = $1
             AND awp.status = 'published'
             AND (
               awp.application_deadline IS NULL
               OR awp.application_deadline > NOW()
             )`,
          [
            user.organisationId,
            user.id
          ]
        );

      const visiblePublications =
        publications.rows.filter(
          (publication) =>
            !publication.is_excluded &&
            (
              publication.audience_mode ===
                "all_suitable" ||
              publication.is_included
            )
        );

      const publicationByItem =
        new Map(
          visiblePublications.map(
            (publication) => [
              String(
                publication.opportunity_item_id
              ),
              publication
            ]
          )
        );

      const applications =
        await query(
          `SELECT
             id,
             opportunity_item_id,
             vacancy_round,
             status,
             decline_reason,
             current_rms_sync_status
           FROM freelancer_applications
           WHERE
             user_id = $1
             AND status IN (
               'pending',
               'accepted',
               'declined'
             )`,
          [user.id]
        );

      const byItem =
        new Map(
          applications.rows.map(
            (application) => [
              [
                String(
                  application
                    .opportunity_item_id
                ),
                String(
                  application
                    .vacancy_round || 1
                )
              ].join(":"),
              application
            ]
          )
        );

      const visibleWork =
        work
          .filter(
            (position) =>
              publicationByItem.has(
                String(
                  position.opportunityItemId
                )
              )
          )
          .map((position) => {
            const publication =
              publicationByItem.get(
                String(
                  position.opportunityItemId
                )
              );

            return {
              ...position,
              freelancerNote:
                publication.freelancer_note,
              applicationDeadline:
                publication
                  .application_deadline,
              application:
                byItem.get(
                  [
                    String(
                      position
                        .opportunityItemId
                    ),
                    String(
                      publication
                        .vacancy_round || 1
                    )
                  ].join(":")
                ) || null
            };
          });

      return response.json({
        work: visibleWork,
        suitabilityConfigured:
          Boolean(
            user.suitableServiceIds?.length
          )
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/api/available-work/:opportunityItemId/apply",
  requireAuthenticatedUser,
  async (request, response, next) => {
    try {
      const user =
        request.session.user;

      if (
        user.personType !== "freelancer"
      ) {
        return response.status(403).json({
          error:
            "Only freelancer accounts can apply."
        });
      }

      const publicationResult =
        await query(
          `SELECT
             awp.*,
             EXISTS (
               SELECT 1
               FROM available_work_exclusions awe
               WHERE
                 awe.publication_id = awp.id
                 AND awe.user_id = $3
             ) AS is_excluded,
             EXISTS (
               SELECT 1
               FROM available_work_inclusions awi
               WHERE
                 awi.publication_id = awp.id
                 AND awi.user_id = $3
             ) AS is_included
           FROM available_work_publications awp
           WHERE
             awp.organisation_id = $1
             AND awp.opportunity_item_id = $2
             AND awp.status = 'published'
             AND (
               awp.application_deadline IS NULL
               OR awp.application_deadline > NOW()
             )
           LIMIT 1`,
          [
            user.organisationId,
            request.params.opportunityItemId,
            user.id
          ]
        );

      const publication =
        publicationResult.rows[0];

      if (
        !publication ||
        publication.is_excluded ||
        (
          publication.audience_mode ===
            "selected" &&
          !publication.is_included
        )
      ) {
        return response.status(409).json({
          error:
            "This position is not currently published to your account."
        });
      }

      const defaults =
        defaultRange();

      const cachedWork =
        await readCachedOpenPositions(
          user.organisationId,
          {
            suitableServiceIds:
              user.suitableServiceIds || [],
            excludeRecordId:
              user.currentRmsRecordType === "member"
                ? user.currentRmsRecordId
                : null
          }
        );

      const work =
        cachedWork.positions;

      const position =
        work.find(
          (item) =>
            String(
              item.opportunityItemId
            ) ===
            String(
              request.params.opportunityItemId
            )
        );

      if (!position) {
        return response.status(409).json({
          error:
            "This position is no longer available."
        });
      }

      const result =
        await query(
          `INSERT INTO freelancer_applications (
             organisation_id,
             user_id,
             opportunity_id,
             opportunity_item_id,
             service_id,
             job_reference,
             job_name,
             customer_name,
             service_name,
             starts_at,
             ends_at,
             message,
             vacancy_round
           )
           VALUES (
             $1,$2,$3,$4,$5,$6,
             $7,$8,$9,$10,$11,$12,
             $13
           )
           ON CONFLICT (
             user_id,
             opportunity_item_id,
             vacancy_round
           )
           WHERE status IN (
             'pending',
             'accepted'
           )
           DO NOTHING
           RETURNING *`,
          [
            user.organisationId,
            user.id,
            position.opportunityId,
            position.opportunityItemId,
            position.serviceId || null,
            position.reference || null,
            position.name,
            position.customer || null,
            position.serviceName,
            position.startsAt,
            position.endsAt,
            String(
              request.body?.message || ""
            ).trim() || null,
            Number(
              publication.vacancy_round || 1
            )
          ]
        );

      if (!result.rows[0]) {
        return response.status(409).json({
          error:
            "You have already marked yourself available for this position."
        });
      }

      await query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,$2,
           'freelancer.application_created',
           'freelancer_application',
           $3,
           $4::jsonb
         )`,
        [
          user.organisationId,
          user.id,
          result.rows[0].id,
          JSON.stringify({
            opportunityItemId:
              position.opportunityItemId
          })
        ]
      );

      try {
        await notifyFreelancerApprovers({
          organisationId:
            user.organisationId,
          freelancerName:
            user.fullName,
          jobName:
            position.name,
          serviceName:
            position.serviceName,
          startsAt:
            position.startsAt
        });
      } catch (emailError) {
        console.error(
          "Freelancer application email failed:",
          emailError
        );
      }

      return response.status(201).json({
        application:
          result.rows[0]
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.patch(
  "/api/available-work/applications/:id/withdraw",
  requireAuthenticatedUser,
  async (request, response, next) => {
    try {
      const result =
        await query(
          `UPDATE freelancer_applications
           SET
             status = 'withdrawn',
             updated_at = NOW()
           WHERE
             id = $1
             AND user_id = $2
             AND status = 'pending'
           RETURNING *`,
          [
            request.params.id,
            request.session.user.id
          ]
        );

      if (!result.rows[0]) {
        return response.status(404).json({
          error:
            "Pending application not found."
        });
      }

      return response.json({
        application:
          result.rows[0]
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/freelancer-applications",
  requireFreelancerApprover,
  async (request, response, next) => {
    try {
      const result =
        await query(
          `SELECT
             fa.*,
             u.full_name AS freelancer_name,
             u.email AS freelancer_email,
             u.current_rms_record_type,
             u.current_rms_record_id
           FROM freelancer_applications fa
           JOIN users u
             ON u.id = fa.user_id
           WHERE
             fa.organisation_id = $1
             AND fa.status IN (
               'pending',
               'accepted',
               'declined',
               'historical',
               'returned'
             )
           ORDER BY
             CASE fa.status
               WHEN 'pending' THEN 0
               ELSE 1
             END,
             fa.starts_at ASC NULLS LAST,
             fa.created_at DESC`,
          [
            request.session.user.organisationId
          ]
        );

      return response.json({
        applications:
          result.rows,
        allocationWritesEnabled:
          booleanEnv(
            "ENABLE_CURRENT_RMS_ALLOCATION_WRITES"
          )
      });
    } catch (error) {
      return next(error);
    }
  }
);



app.get(
  "/api/freelancer-applications/:id/member-diagnostic",
  requireFreelancerApprover,
  async (request, response, next) => {
    try {
      const result =
        await query(
          `SELECT
             fa.id,
             fa.service_id,
             u.current_rms_record_type,
             u.current_rms_record_id,
             u.full_name
           FROM freelancer_applications fa
           JOIN users u
             ON u.id = fa.user_id
           WHERE
             fa.id = $1
             AND fa.organisation_id = $2
           LIMIT 1`,
          [
            request.params.id,
            request.session.user
              .organisationId
          ]
        );

      const application =
        result.rows[0];

      if (!application) {
        return response.status(404).json({
          error:
            "Freelancer application not found."
        });
      }

      if (
        application
          .current_rms_record_type !==
          "member" ||
        !application
          .current_rms_record_id
      ) {
        return response.status(409).json({
          error:
            "The freelancer must be mapped to a Current RMS member."
        });
      }

      const diagnostic =
        await inspectCurrentRmsMember({
          memberId:
            application
              .current_rms_record_id,
          serviceId:
            application
              .service_id
        });

      return response.json({
        application: {
          id:
            application.id,
          freelancerName:
            application.full_name
        },
        diagnostic
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.get(
  "/api/freelancer-applications/:id/allocation-diagnostic",
  requireFreelancerApprover,
  async (request, response, next) => {
    try {
      const result =
        await query(
          `SELECT
             fa.id,
             fa.opportunity_id,
             fa.opportunity_item_id,
             fa.status,
             u.current_rms_record_type,
             u.current_rms_record_id,
             u.full_name
           FROM freelancer_applications fa
           JOIN users u
             ON u.id = fa.user_id
           WHERE
             fa.id = $1
             AND fa.organisation_id = $2
           LIMIT 1`,
          [
            request.params.id,
            request.session.user
              .organisationId
          ]
        );

      const application =
        result.rows[0];

      if (!application) {
        return response.status(404).json({
          error:
            "Freelancer application not found."
        });
      }

      if (
        application
          .current_rms_record_type !==
          "member" ||
        !application
          .current_rms_record_id
      ) {
        return response.status(409).json({
          error:
            "The freelancer must be mapped to a Current RMS member before an allocation can be prepared."
        });
      }

      const diagnostic =
        await getAllocationDiagnostic({
          opportunityId:
            application
              .opportunity_id,
          opportunityItemId:
            application
              .opportunity_item_id,
          memberId:
            application
              .current_rms_record_id
        });

      await query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,$2,
           'freelancer.allocation_diagnostic_viewed',
           'freelancer_application',
           $3,
           $4::jsonb
         )`,
        [
          request.session.user
            .organisationId,
          request.session.user.id,
          application.id,
          JSON.stringify({
            ready:
              diagnostic.ready,
            opportunityItemId:
              application
                .opportunity_item_id,
            memberId:
              application
                .current_rms_record_id,
            stockLevelId:
              diagnostic
                .selectedStockLevel
                ?.id || null
          })
        ]
      );

      return response.json({
        application: {
          id:
            application.id,
          freelancerName:
            application.full_name,
          status:
            application.status,
          canAllocate:
            request.session.user.role === "admin" &&
            booleanEnv("ENABLE_CURRENT_RMS_ALLOCATION_WRITES")
        },
        diagnostic
      });
    } catch (error) {
      return next(error);
    }
  }
);


app.post(
  "/api/freelancer-applications/:id/allocate-current-rms",
  requireRole("admin"),
  async (request, response, next) => {
    if (
      !booleanEnv(
        "ENABLE_CURRENT_RMS_ALLOCATION_WRITES"
      )
    ) {
      return response.status(403).json({
        error:
          "Current RMS allocation writes are disabled."
      });
    }

    const client =
      await getPool().connect();

    const lockKey =
      `wolf-freelancer-allocation:${request.params.id}`;

    let locked = false;

    try {
      const lockResult =
        await client.query(
          `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
          [lockKey]
        );

      locked =
        lockResult.rows[0]?.locked === true;

      if (!locked) {
        return response.status(409).json({
          error:
            "This application is already being allocated by another administrator."
        });
      }

      const applicationResult =
        await query(
          `SELECT
             fa.*,
             u.full_name AS freelancer_name,
             u.email AS freelancer_email,
             u.current_rms_record_type,
             u.current_rms_record_id
           FROM freelancer_applications fa
           JOIN users u
             ON u.id = fa.user_id
           WHERE
             fa.id = $1
             AND fa.organisation_id = $2
           LIMIT 1`,
          [
            request.params.id,
            request.session.user.organisationId
          ]
        );

      const application =
        applicationResult.rows[0];

      if (!application) {
        return response.status(404).json({
          error:
            "Freelancer application not found."
        });
      }

      if (application.status !== "accepted") {
        return response.status(409).json({
          error:
            "Accept the freelancer before allocating them in Current RMS."
        });
      }

      if (
        application.current_rms_sync_status ===
        "synced"
      ) {
        return response.json({
          ok: true,
          alreadySynced: true,
          application
        });
      }

      if (
        application.current_rms_record_type !==
          "member" ||
        !application.current_rms_record_id
      ) {
        return response.status(409).json({
          error:
            "The freelancer is not mapped to a Current RMS member."
        });
      }

      await query(
        `UPDATE freelancer_applications
         SET
           current_rms_sync_status = 'pending',
           sync_error = NULL,
           updated_at = NOW()
         WHERE id = $1`,
        [application.id]
      );

      const conflictCheck =
        await findMemberAssignmentConflicts({
          memberId:
            application.current_rms_record_id,
          startsAt:
            application.starts_at,
          endsAt:
            application.ends_at,
          excludeOpportunityItemId:
            application.opportunity_item_id
        });

      if (conflictCheck.hasConflict) {
        const firstConflict =
          conflictCheck.conflicts[0];

        const conflictDescription =
          [
            firstConflict.jobName,
            firstConflict.serviceName
          ]
            .filter(Boolean)
            .join(" · ");

        await query(
          `UPDATE freelancer_applications
           SET
             current_rms_sync_status = 'failed',
             sync_error = $1,
             updated_at = NOW()
           WHERE id = $2`,
          [
            `Double-booking conflict: ${conflictDescription}`,
            application.id
          ]
        );

        return response.status(409).json({
          error:
            "This freelancer is already assigned to another Current RMS shift that overlaps these times.",
          conflict:
            firstConflict,
          conflicts:
            conflictCheck.conflicts
        });
      }

      let allocation;

      try {
        allocation =
          await allocateResourceToOpportunityItem({
            opportunityId:
              application.opportunity_id,
            opportunityItemId:
              application.opportunity_item_id,
            memberId:
              application.current_rms_record_id
          });
      } catch (allocationError) {
        await query(
          `UPDATE freelancer_applications
           SET
             current_rms_sync_status = 'failed',
             sync_error = $1,
             updated_at = NOW()
           WHERE id = $2`,
          [
            allocationError.message,
            application.id
          ]
        );

        await query(
          `INSERT INTO audit_logs (
             organisation_id,
             actor_user_id,
             action,
             entity_type,
             entity_id,
             metadata
           )
           VALUES (
             $1,$2,
             'freelancer.current_rms_allocation_failed',
             'freelancer_application',
             $3,
             $4::jsonb
           )`,
          [
            request.session.user.organisationId,
            request.session.user.id,
            application.id,
            JSON.stringify({
              error:
                allocationError.message,
              status:
                allocationError.status || null,
              request:
                allocationError.request || null,
              payload:
                allocationError.payload || null
            })
          ]
        );

        return response.status(
          allocationError.status &&
          allocationError.status >= 400 &&
          allocationError.status < 600
            ? allocationError.status
            : 502
        ).json({
          error:
            allocationError.message,
          currentRmsDetails:
            allocationError.payload || null
        });
      }

      const updated =
        await query(
          `UPDATE freelancer_applications
           SET
             current_rms_sync_status = 'synced',
             current_rms_allocation_id = $1,
             sync_error = NULL,
             current_rms_synced_at = NOW(),
             updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [
            allocation.allocationId,
            application.id
          ]
        );

      await query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,$2,
           'freelancer.current_rms_allocation_synced',
           'freelancer_application',
           $3,
           $4::jsonb
         )`,
        [
          request.session.user.organisationId,
          request.session.user.id,
          application.id,
          JSON.stringify({
            allocationId:
              allocation.allocationId,
            stockLevelId:
              allocation.stockLevelId,
            opportunityItemId:
              allocation.opportunityItemId
          })
        ]
      );

      try {
        await sendFreelancerAllocationConfirmation({
          email:
            application.freelancer_email,
          fullName:
            application.freelancer_name,
          jobName:
            application.job_name,
          serviceName:
            application.service_name,
          startsAt:
            application.starts_at,
          endsAt:
            application.ends_at
        });
      } catch (emailError) {
        console.error(
          "Allocation confirmation email failed:",
          emailError
        );
      }

      syncCurrentRmsCache({
        organisationId:
          request.session.user.organisationId,
        triggerType: "manual",
        userId:
          request.session.user.id,
        force: true
      }).catch((syncError) => {
        console.error(
          "Post-allocation cache refresh failed:",
          syncError
        );
      });

      return response.json({
        ok: true,
        application:
          updated.rows[0],
        allocation
      });
    } catch (error) {
      return next(error);
    } finally {
      if (locked) {
        try {
          await client.query(
            `SELECT pg_advisory_unlock(hashtext($1))`,
            [lockKey]
          );
        } catch {}
      }

      client.release();
    }
  }
);

app.patch(
  "/api/freelancer-applications/:id/review",
  requireFreelancerApprover,
  async (request, response, next) => {
    try {
      const decision =
        String(
          request.body?.decision || ""
        );

      if (
        !["accept", "decline"].includes(
          decision
        )
      ) {
        return response.status(400).json({
          error:
            "Choose accept or decline."
        });
      }

      if (decision === "accept") {
        const applicationCheck =
          await query(
            `SELECT
               fa.opportunity_id,
               fa.opportunity_item_id,
               u.current_rms_record_type,
               u.current_rms_record_id
             FROM freelancer_applications fa
             JOIN users u
               ON u.id = fa.user_id
             WHERE
               fa.id = $1
               AND fa.organisation_id = $2
               AND fa.status = 'pending'
             LIMIT 1`,
            [
              request.params.id,
              request.session.user
                .organisationId
            ]
          );

        const pendingApplication =
          applicationCheck.rows[0];

        if (!pendingApplication) {
          return response.status(409).json({
            error:
              "This application has already been reviewed."
          });
        }

        const validation =
          await validateAvailablePosition({
            opportunityId:
              pendingApplication
                .opportunity_id,
            opportunityItemId:
              pendingApplication
                .opportunity_item_id,
            excludeRecordId:
              pendingApplication
                .current_rms_record_type ===
                "member"
                ? pendingApplication
                    .current_rms_record_id
                : null
          });

        if (!validation.available) {
          syncCurrentRmsCache({
            organisationId:
              request.session.user
                .organisationId,
            triggerType: "manual",
            userId:
              request.session.user.id,
            force: true
          }).catch((syncError) => {
            console.error(
              "Post-validation cache refresh failed:",
              syncError
            );
          });

          return response.status(409).json({
            error:
              validation.reason ||
              "This position is no longer available in Current RMS."
          });
        }
      }

      const status =
        decision === "accept"
          ? "accepted"
          : "declined";

      const syncStatus =
        decision === "accept"
          ? "pending"
          : "not_started";

      const result =
        await query(
          `UPDATE freelancer_applications
           SET
             status = $1,
             reviewed_by_user_id = $2,
             reviewed_at = NOW(),
             decline_reason = $3,
             current_rms_sync_status = $4,
             updated_at = NOW()
           WHERE
             id = $5
             AND organisation_id = $6
             AND status = 'pending'
           RETURNING *`,
          [
            status,
            request.session.user.id,
            decision === "decline"
              ? String(
                  request.body?.reason || ""
                ).trim() || null
              : null,
            syncStatus,
            request.params.id,
            request.session.user.organisationId
          ]
        );

      if (!result.rows[0]) {
        return response.status(409).json({
          error:
            "This application has already been reviewed."
        });
      }

      await query(
        `INSERT INTO audit_logs (
           organisation_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,$2,$3,
           'freelancer_application',
           $4,
           $5::jsonb
         )`,
        [
          request.session.user.organisationId,
          request.session.user.id,
          decision === "accept"
            ? 'freelancer.application_accepted'
            : 'freelancer.application_declined',
          result.rows[0].id,
          JSON.stringify({
            currentRmsSyncStatus:
              syncStatus
          })
        ]
      );

      return response.json({
        application:
          result.rows[0],
        currentRmsMessage:
          decision === "accept"
            ? (
                booleanEnv(
                  "ENABLE_CURRENT_RMS_ALLOCATION_WRITES"
                )
                  ? "Accepted in Staff Hub. Use Allocation details to verify the prepared Current RMS resource mapping before enabling write-back."
                  : "Accepted in Staff Hub. Current RMS allocation is pending."
              )
            : null
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/api/me/jobs", requireAuthenticatedUser, async (request, response, next) => {
  try {
    const defaults = defaultRange();
    const user = request.session.user;
    const cached = booleanEnv("USE_MOCK_DATA")
      ? { jobs: mockJobs().slice(0, 3), syncedAt: new Date().toISOString() }
      : await readCachedJobs(
          user.organisationId,
          {
            recordType: user.currentRmsRecordType || "none",
            recordId: user.currentRmsRecordId || null
          }
        );

    const jobs = cached.jobs;

    response.json({
      jobs,
      mapping: {
        recordType: user.currentRmsRecordType || "none",
        recordId: user.currentRmsRecordId || null
      },
      from: defaults.from,
      to: defaults.to,
      cacheSyncedAt: cached.syncedAt || null,
      cacheError: cached.lastError || null
    });
  } catch (error) {
    next(error);
  }
});


app.get(
  "/api/admin/settings",
  requireRole("admin"),
  async (request, response, next) => {
    try {
      const settings = await getSyncSettings(request.session.user.organisationId);
      const status = await getCacheStatus(request.session.user.organisationId);
      response.json({ settings, ...status, environment: {
        currentRmsConfigured: Boolean(process.env.CURRENT_RMS_API_KEY && process.env.CURRENT_RMS_SUBDOMAIN),
        smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_FROM_EMAIL),
        allocationWritesEnabled: booleanEnv("ENABLE_CURRENT_RMS_ALLOCATION_WRITES")
      }});
    } catch (error) { next(error); }
  }
);

app.patch(
  "/api/admin/settings/sync",
  requireRole("admin"),
  async (request, response, next) => {
    try {
      const settings = await updateSyncSettings(
        request.session.user.organisationId,
        request.session.user.id,
        {
          autoSync: request.body?.autoSync === true,
          syncIntervalMinutes: request.body?.syncIntervalMinutes
        }
      );
      await query(`INSERT INTO audit_logs (organisation_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'settings.sync_updated','organisation',$3,$4::jsonb)`, [request.session.user.organisationId,request.session.user.id,request.session.user.organisationId,JSON.stringify(settings)]);
      response.json({ settings });
    } catch (error) { next(error); }
  }
);

app.post(
  "/api/admin/settings/sync-now",
  requireRole("admin"),
  async (request, response, next) => {
    try {
      const result = await syncCurrentRmsCache({ organisationId: request.session.user.organisationId, triggerType: "manual", userId: request.session.user.id, force: true });
      response.json(result);
    } catch (error) { next(error); }
  }
);

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
  async (request, response, next) => {
    try {
      const defaults = defaultRange();
      const from = validDate(request.query.from) ? request.query.from : defaults.from;
      const to = validDate(request.query.to) ? request.query.to : defaults.to;
      const cached = booleanEnv("USE_MOCK_DATA")
        ? { jobs: mockJobs(), syncedAt: new Date().toISOString(), lastError: null }
        : await readCachedJobs(request.session.user.organisationId);
      const jobs = cached.jobs.filter((job) => {
        const dates = [job.prepAt,job.loadAt,job.deliverAt,job.showAt,job.returnAt].filter(Boolean).map((v)=>new Date(v));
        if (!dates.length) return true;
        const min = new Date(`${from}T00:00:00Z`);
        const max = new Date(`${to}T23:59:59Z`);
        return dates.some((date)=>date >= min && date <= max);
      });
      response.json({ updatedAt: cached.syncedAt, from, to, jobs, cached: true, cacheError: cached.lastError, mode: booleanEnv("USE_MOCK_DATA") ? "mock" : "current-rms-cache" });
    } catch (error) { next(error); }
  }
);

/* =========================================================
   RAW OPPORTUNITY DIAGNOSTIC
   Example:
   /api/diagnostics/opportunity/3781
   ========================================================= */


app.get(
  "/api/diagnostics/allocation-probe",
  requireRole("admin"),
  async (request, response, next) => {
    try {
      if (!booleanEnv("ENABLE_DIAGNOSTICS")) {
        return response.status(404).json({
          error: "Diagnostics are disabled."
        });
      }

      const opportunityId = String(
        request.query.opportunityId || ""
      ).trim();

      const opportunityItemId = String(
        request.query.opportunityItemId || ""
      ).trim();

      const recordId = String(
        request.query.recordId || ""
      ).trim();

      if (
        !/^\d+$/.test(opportunityId) ||
        !/^\d+$/.test(opportunityItemId) ||
        !/^\d+$/.test(recordId)
      ) {
        return response.status(400).json({
          error:
            "opportunityId, opportunityItemId and recordId must be numeric."
        });
      }

      const diagnostics =
        await probeOpportunityAllocations({
          opportunityId,
          opportunityItemId,
          recordId
        });

      return response.json(diagnostics);
    } catch (error) {
      return next(error);
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
  if (request.session?.user) return response.redirect("/dashboard");
  response.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use("/public", express.static(path.join(__dirname, "public")));


app.get("/admin/settings", requirePageRole("admin"), (request, response) => {
  response.sendFile(path.join(__dirname, "public", "admin-settings.html"));
});

app.get("/admin/users", requirePageRole("admin"), (request, response) => {
  response.sendFile(path.join(__dirname, "public", "admin-users.html"));
});


app.get(
  "/forgot-password",
  (request, response) => {
    if (request.session?.user) {
      return response.redirect(
        "/dashboard"
      );
    }

    return response.sendFile(
      path.join(
        __dirname,
        "public",
        "forgot-password.html"
      )
    );
  }
);

app.get(
  "/reset-password",
  (request, response) => {
    return response.sendFile(
      path.join(
        __dirname,
        "public",
        "reset-password.html"
      )
    );
  }
);

app.get(
  "/account",
  requirePageUser,
  (request, response) => {
    return response.sendFile(
      path.join(
        __dirname,
        "public",
        "account.html"
      )
    );
  }
);



app.get(
  "/open-work-admin",
  requirePageUser,
  (request, response) => {
    response.sendFile(
      path.join(
        __dirname,
        "public",
        "open-work-admin.html"
      )
    );
  }
);

app.get(
  "/available-work",
  requirePageUser,
  (request, response) => {
    response.sendFile(
      path.join(
        __dirname,
        "public",
        "available-work.html"
      )
    );
  }
);

app.get(
  "/freelancer-applications",
  requirePageUser,
  (request, response) => {
    response.sendFile(
      path.join(
        __dirname,
        "public",
        "freelancer-applications.html"
      )
    );
  }
);

app.get("/dashboard", requirePageUser, (request, response) => {
  response.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/", requirePageUser, (request, response) => {
  response.redirect("/dashboard");
});

app.use(requirePageUser);
app.use("/warehouse", requireAuthenticatedUser, express.static(path.join(__dirname, "docs")));
app.use(express.static(path.join(__dirname, "public")));

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
        "public",
        "dashboard.html"
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

startCurrentRmsSyncScheduler();

app.listen(
  port,
  () => {
    console.log(
      `Wolf Warehouse Dashboard running at http://localhost:${port}`
    );
  }
);