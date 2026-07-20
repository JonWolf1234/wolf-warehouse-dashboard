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
       u.person_type,
       u.role,
       u.status,
       u.current_rms_member_id,
       u.current_rms_contact_id,
       u.current_rms_record_type,
       u.current_rms_record_id,
       u.breathe_employee_id,
       u.can_open_current_rms,
       u.can_approve_freelancers,
       u.suitable_service_ids,
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
    personType: user.person_type || (user.employment_type === "freelancer" ? "freelancer" : "staff"),
    role: user.role,
    status: user.status,
    currentRmsMemberId: user.current_rms_member_id,
    currentRmsContactId: user.current_rms_contact_id,
    currentRmsRecordType: user.current_rms_record_type || (user.current_rms_member_id ? "member" : user.current_rms_contact_id ? "contact" : "none"),
    currentRmsRecordId: user.current_rms_record_id || user.current_rms_member_id || user.current_rms_contact_id || null,
    breatheEmployeeId: user.breathe_employee_id,
    canOpenCurrentRms: Boolean(user.can_open_current_rms),
    canApproveFreelancers: Boolean(user.can_approve_freelancers),
    suitableServiceIds: Array.isArray(user.suitable_service_ids)
      ? user.suitable_service_ids
      : []
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
