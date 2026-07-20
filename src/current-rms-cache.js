import { query, getPool } from "./database.js";
import {
  getSharedCurrentRmsSnapshot,
  consumeCurrentRmsRequestCount
} from "./current-rms.js";

let schedulerTimer = null;
let localSyncPromise = null;

function dateOnly(date) { return date.toISOString().slice(0,10); }
function syncRange() {
  const from = new Date(); from.setDate(from.getDate() - 2);
  const to = new Date(); to.setDate(to.getDate() + Number(process.env.CURRENT_RMS_CACHE_DAYS_AHEAD || 120));
  return { from: dateOnly(from), to: dateOnly(to) };
}

export async function ensureOrganisationSettings(organisationId) {
  await query(`INSERT INTO organisation_settings (organisation_id) VALUES ($1) ON CONFLICT DO NOTHING`, [organisationId]);
  await query(`INSERT INTO current_rms_cache_snapshots (organisation_id) VALUES ($1) ON CONFLICT DO NOTHING`, [organisationId]);
}

export async function getSyncSettings(organisationId) {
  await ensureOrganisationSettings(organisationId);
  const result = await query(`SELECT * FROM organisation_settings WHERE organisation_id = $1`, [organisationId]);
  return result.rows[0];
}

export async function updateSyncSettings(organisationId, userId, values) {
  const interval = Math.min(120, Math.max(2, Number(values.syncIntervalMinutes || 5)));
  const result = await query(`UPDATE organisation_settings SET current_rms_auto_sync = $1, current_rms_sync_interval_minutes = $2, updated_by_user_id = $3, updated_at = NOW() WHERE organisation_id = $4 RETURNING *`, [values.autoSync === true, interval, userId, organisationId]);
  return result.rows[0];
}

export async function getCacheStatus(organisationId) {
  await ensureOrganisationSettings(organisationId);
  const snapshot = await query(`SELECT range_from, range_to, synced_at, last_error, jsonb_array_length(jobs) AS jobs_count, jsonb_array_length(open_positions) AS positions_count FROM current_rms_cache_snapshots WHERE organisation_id = $1`, [organisationId]);
  const latest = await query(`SELECT * FROM current_rms_sync_runs WHERE organisation_id = $1 ORDER BY started_at DESC LIMIT 10`, [organisationId]);
  return { snapshot: snapshot.rows[0], runs: latest.rows };
}

export async function syncCurrentRmsCache({ organisationId, triggerType = "automatic", userId = null, force = false }) {
  if (localSyncPromise) return { skipped: true, reason: "A sync is already running." };
  localSyncPromise = (async () => {
    const client = await getPool().connect();
    let runId;
    try {
      const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [`wolf-current-rms-sync:${organisationId}`]);
      if (!lock.rows[0].locked) return { skipped: true, reason: "A sync is already running on another instance." };
      const settings = await getSyncSettings(organisationId);
      const status = await getCacheStatus(organisationId);
      if (!force && triggerType === "automatic" && settings.current_rms_auto_sync !== true) return { skipped: true, reason: "Automatic sync is disabled." };
      if (!force && triggerType === "automatic" && status.snapshot?.synced_at) {
        const dueAt = new Date(status.snapshot.synced_at).getTime() + Number(settings.current_rms_sync_interval_minutes || 5) * 60000;
        if (Date.now() < dueAt) return { skipped: true, reason: "Cache is still fresh." };
      }
      const run = await query(`INSERT INTO current_rms_sync_runs (organisation_id, trigger_type, status, started_by_user_id) VALUES ($1,$2,'running',$3) RETURNING id`, [organisationId, triggerType, userId]);
      runId = run.rows[0].id;
      consumeCurrentRmsRequestCount();
      const range = syncRange();
      const snapshot = await getSharedCurrentRmsSnapshot({ fromDate: range.from, toDate: range.to });
      const requestCount = consumeCurrentRmsRequestCount();
      await query(`UPDATE current_rms_cache_snapshots SET jobs = $1::jsonb, open_positions = $2::jsonb, range_from = $3, range_to = $4, synced_at = NOW(), source_updated_at = $5, last_error = NULL, updated_at = NOW() WHERE organisation_id = $6`, [JSON.stringify(snapshot.jobs), JSON.stringify(snapshot.openPositions), range.from, range.to, snapshot.syncedAt, organisationId]);
      await query(`UPDATE current_rms_sync_runs SET status='success', completed_at=NOW(), jobs_count=$1, positions_count=$2, request_count=$3 WHERE id=$4`, [snapshot.jobs.length, snapshot.openPositions.length, requestCount, runId]);
      return { ok: true, jobsCount: snapshot.jobs.length, positionsCount: snapshot.openPositions.length, requestCount };
    } catch (error) {
      if (runId) await query(`UPDATE current_rms_sync_runs SET status='failed', completed_at=NOW(), error_message=$1, request_count=$2 WHERE id=$3`, [error.message, consumeCurrentRmsRequestCount(), runId]);
      await query(`UPDATE current_rms_cache_snapshots SET last_error=$1, updated_at=NOW() WHERE organisation_id=$2`, [error.message, organisationId]);
      throw error;
    } finally {
      try { await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`wolf-current-rms-sync:${organisationId}`]); } catch {}
      client.release();
    }
  })();
  try { return await localSyncPromise; } finally { localSyncPromise = null; }
}


function deduplicateCachedAssignments(
  assignments = []
) {
  const seen =
    new Set();

  return assignments.filter(
    (assignment) => {
      /*
       * Ignore nested allocation IDs here. One Current RMS
       * shift may appear through more than one included
       * relationship, but the service and times are identical.
       */
      const key = [
        String(
          assignment.serviceId || ""
        ),
        String(
          assignment.name || ""
        ).trim().toLowerCase(),
        String(
          assignment.startsAt || ""
        ),
        String(
          assignment.endsAt || ""
        )
      ].join("|");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    }
  );
}

export async function readCachedJobs(organisationId, assignment = null) {
  const result = await query(`SELECT jobs, synced_at, last_error FROM current_rms_cache_snapshots WHERE organisation_id=$1`, [organisationId]);
  const row = result.rows[0] || {};
  const all = Array.isArray(row.jobs) ? row.jobs : [];
  if (!assignment?.recordId || !["member","contact"].includes(assignment.recordType)) return { jobs: all, syncedAt: row.synced_at, lastError: row.last_error };
  const key = `${assignment.recordType}:${assignment.recordId}`;
  const jobs = all.filter((job) => Array.isArray(job.assignmentIndex?.[key]) && job.assignmentIndex[key].length).map((job) => {
    const assignments =
      deduplicateCachedAssignments(
        job.assignmentIndex[key]
      );

    const names = [
      ...new Set(
        assignments
          .map(
            (item) =>
              item.name
          )
          .filter(Boolean)
      )
    ];

    const starts =
      assignments
        .map(
          (item) =>
            item.startsAt
        )
        .filter(Boolean)
        .sort();

    const ends =
      assignments
        .map(
          (item) =>
            item.endsAt
        )
        .filter(Boolean)
        .sort();

    return {
      ...job,
      assignments,
      assignedRole:
        names.join(", "),
      callAt:
        starts[0] ||
        job.showAt ||
        job.deliverAt ||
        null,
      finishAt:
        ends.at(-1) ||
        job.returnAt ||
        null
    };
  });
  return { jobs, syncedAt: row.synced_at, lastError: row.last_error };
}

export async function readCachedOpenPositions(organisationId, { suitableServiceIds = [], excludeRecordId = null } = {}) {
  const result = await query(`SELECT open_positions, synced_at, last_error FROM current_rms_cache_snapshots WHERE organisation_id=$1`, [organisationId]);
  const row = result.rows[0] || {};
  const allowed = new Set((suitableServiceIds || []).map(String));
  const memberKey = excludeRecordId ? `member:${excludeRecordId}` : null;
  const positions = (Array.isArray(row.open_positions) ? row.open_positions : []).filter((position) => {
    if (allowed.size && !allowed.has(String(position.serviceId || ""))) return false;
    if (memberKey && (position.assignedRecordKeys || []).includes(memberKey)) return false;
    return Number(position.openPositions || 0) > 0;
  });
  return { positions, syncedAt: row.synced_at, lastError: row.last_error };
}

export async function startCurrentRmsSyncScheduler() {
  if (schedulerTimer) return;
  async function tick() {
    try {
      const organisations = await query(`SELECT id FROM organisations`);
      for (const org of organisations.rows) {
        try { await syncCurrentRmsCache({ organisationId: org.id, triggerType: "automatic" }); }
        catch (error) { console.error("[Current RMS sync]", error.message); }
      }
    } catch (error) { console.error("[Current RMS scheduler]", error.message); }
  }
  setTimeout(tick, 1500);
  schedulerTimer = setInterval(tick, 60_000);
}
