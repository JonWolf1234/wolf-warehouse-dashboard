import bcrypt from "bcryptjs";
import { query } from "./database.js";

export const ROLE_NAMES = [
  "admin",
  "scheduler",
  "staff",
  "freelancer",
  "viewer"
];

export async function findUserByEmail(email) {
  const result = await query(
    `SELECT
       u.id,
       u.organisation_id,
       u.email,
       u.full_name,
       u.password_hash,
       u.employment_type,
       u.role,
       u.status,
       u.current_rms_member_id,
       u.current_rms_contact_id,
       u.breathe_employee_id,
       o.name AS organisation_name
     FROM users u
     JOIN organisations o ON o.id = u.organisation_id
     WHERE LOWER(u.email) = LOWER($1)
     LIMIT 1`,
    [email]
  );

  return result.rows[0] || null;
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    organisationId: user.organisation_id,
    organisationName: user.organisation_name,
    email: user.email,
    fullName: user.full_name,
    employmentType: user.employment_type,
    role: user.role,
    status: user.status,
    currentRmsMemberId: user.current_rms_member_id,
    currentRmsContactId: user.current_rms_contact_id,
    breatheEmployeeId: user.breathe_employee_id
  };
}

export function requireAuthenticatedUser(request, response, next) {
  if (!request.session?.user) {
    return response.status(401).json({ error: "Please sign in." });
  }

  next();
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    const user = request.session?.user;

    if (!user) {
      return response.status(401).json({ error: "Please sign in." });
    }

    if (!allowedRoles.includes(user.role)) {
      return response.status(403).json({ error: "You do not have permission to use this area." });
    }

    next();
  };
}
