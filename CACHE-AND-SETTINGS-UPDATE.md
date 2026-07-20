# Wolf Staff Hub – Shared Current RMS Cache

## Install
1. Replace the project with this ZIP while retaining your own `.env`.
2. Run `npm run migrate`.
3. Run `npm run check`.
4. Start with `npm start`.
5. Sign in as admin and open `/admin/settings`.
6. Press **Sync Current RMS now** for the first snapshot.

Normal dashboards now read PostgreSQL cache data. The scheduler checks once per minute and syncs when the configured interval is due. API requests are spaced by at least 1.1 seconds. Accepting a freelancer performs a fresh Current RMS validation before approval.
