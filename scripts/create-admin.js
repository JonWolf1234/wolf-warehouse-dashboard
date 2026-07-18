import "dotenv/config";
import { getPool } from "../src/database.js";
import { hashPassword } from "../src/auth.js";

const [email, password, fullName = "Wolf Administrator"] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: npm run create-admin -- "you@example.com" "strong-password" "Your Name"');
  process.exit(1);
}

if (password.length < 12) {
  console.error("Use a password of at least 12 characters.");
  process.exit(1);
}

const pool = getPool();

try {
  const organisationResult = await pool.query(
    `INSERT INTO organisations (name, slug)
     VALUES ('Wolf Event Services Ltd', 'wolf-event-services')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );

  const organisationId = organisationResult.rows[0].id;
  const passwordHash = await hashPassword(password);

  await pool.query(
    `INSERT INTO users (
       organisation_id, email, full_name, password_hash,
       employment_type, role, status
     ) VALUES ($1, LOWER($2), $3, $4, 'full_time', 'admin', 'active')
     ON CONFLICT (organisation_id, email)
     DO UPDATE SET
       full_name = EXCLUDED.full_name,
       password_hash = EXCLUDED.password_hash,
       role = 'admin',
       status = 'active',
       updated_at = NOW()`,
    [organisationId, email, fullName, passwordHash]
  );

  console.log(`Admin account ready for ${email}.`);
} finally {
  await pool.end();
}
