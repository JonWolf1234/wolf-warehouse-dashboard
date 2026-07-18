# Wolf Staff Hub foundation

## What this version adds

- PostgreSQL organisations, users and audit logs
- Secure server-side sessions
- Email/password sign-in
- Roles: admin, scheduler, staff, freelancer and viewer
- Admin account creation and suspension
- Current RMS/Breathe mapping fields
- Existing warehouse and certificate routes protected by login
- Render PostgreSQL blueprint

## Local setup

1. Install PostgreSQL and create a database named `wolf_staff_hub`.
2. Copy `.env.example` to `.env` and update `DATABASE_URL` and `SESSION_SECRET`.
3. Run:

```bash
npm install
npm run migrate
npm run create-admin -- "your-email@example.com" "a-password-of-at-least-12-characters" "Jonathan Oliver"
npm start
```

4. Open `http://localhost:3000/login`.

## Render deployment

The revised `render.yaml` creates a web service and PostgreSQL database. After deployment, use Render Shell once to create the first administrator:

```bash
npm run create-admin -- "your-email@example.com" "a-password-of-at-least-12-characters" "Jonathan Oliver"
```

Do not commit `.env` or any API credentials.

## Important first-test checklist

- Sign in and sign out
- Create a staff user and a freelancer
- Suspend the test user and confirm sign-in is refused
- Open the warehouse dashboard while signed in
- Confirm `/api/jobs` returns 401 after signing out
