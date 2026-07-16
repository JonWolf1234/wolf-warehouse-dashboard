# Wolf Warehouse Dashboard

A full-screen warehouse schedule that reads upcoming jobs from Current RMS and displays:

- Job number and name
- Customer name (optional)
- Total physical rental quantity
- Prepared quantity and progress
- Prep date
- Load-out date
- Due-back date
- Search, date filtering and sortable columns
- Automatic refresh and full-screen mode

The project uses one GitHub repository:

- `/docs` is the static GitHub Pages dashboard.
- The repository root is a Node/Express API deployed on Render.
- The Current RMS API key is stored only in Render Environment Variables.

## Important security rule

Never put the Current RMS API key in `docs/config.js`, `app.js`, HTML, CSS, GitHub Pages, a screenshot or a GitHub commit. Current RMS API keys have powerful access to the account. Store the key only in a local `.env` file for local testing and in Render Environment Variables online.

## Project structure

```text
wolf-warehouse-dashboard/
├── docs/
│   ├── .nojekyll
│   ├── index.html
│   ├── styles.css
│   ├── config.js
│   └── app.js
├── src/
│   ├── current-rms.js
│   ├── mock-data.js
│   └── normalise.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── render.yaml
├── server.js
└── README.md
```

# Part 1 — Test it locally on your Mac

## 1. Install Node.js

Install the current Node.js LTS release if it is not already installed. Confirm it in Terminal:

```bash
node --version
npm --version
```

Node should report version 20 or later.

## 2. Open the project in VS Code

1. Unzip the project.
2. Open VS Code.
3. Choose **File → Open Folder**.
4. Select the `wolf-warehouse-dashboard` folder.
5. Open **Terminal → New Terminal**.

## 3. Install the packages

```bash
npm install
```

## 4. Create the local environment file

```bash
cp .env.example .env
```

Open `.env` in VS Code and start with:

```env
USE_MOCK_DATA=true
DASHBOARD_ACCESS_KEY=replace-this-with-a-long-private-passphrase
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

The `.env` file is excluded by `.gitignore` and must never be committed.

## 5. Run the dashboard

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Enter the same `DASHBOARD_ACCESS_KEY` value from `.env`. You should see four demonstration jobs.

Stop the local server with **Control + C** in Terminal.

# Part 2 — Create the GitHub repository

The repository name used in this guide is:

```text
wolf-warehouse-dashboard
```

## 1. Create the repository on GitHub

1. Sign in to GitHub.
2. Click the **+** menu in the top-right.
3. Choose **New repository**.
4. Owner: `JonWolf1234`.
5. Repository name: `wolf-warehouse-dashboard`.
6. Description: `Warehouse schedule connected to Current RMS`.
7. Select **Public** if using GitHub Free Pages.
8. **Do not** add a README, `.gitignore` or licence because the project already contains them.
9. Click **Create repository**.

Leaving the new GitHub repository empty avoids the divergent-branches problem that can happen when both GitHub and the local folder begin with different first commits.

## 2. Push the local project to GitHub

In the VS Code terminal, from inside the project folder:

```bash
git init
git branch -M main
git add .
git commit -m "Create warehouse dashboard"
git remote add origin https://github.com/JonWolf1234/wolf-warehouse-dashboard.git
git push -u origin main
```

Before committing, check that `.env` is not included:

```bash
git status
```

You should see `.env.example`, but you must not see `.env`.

# Part 3 — Enable GitHub Pages

1. Open the repository on GitHub.
2. Click **Settings**.
3. In the left menu, click **Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Branch: `main`.
6. Folder: `/docs`.
7. Click **Save**.

The public dashboard address will normally be:

```text
https://jonwolf1234.github.io/wolf-warehouse-dashboard/
```

The page will display, but its API URL has not yet been configured.

# Part 4 — Deploy the secure API to Render

## 1. Create the service

1. Sign in to Render.
2. Click **New → Web Service**.
3. Connect GitHub if required.
4. Select `JonWolf1234/wolf-warehouse-dashboard`.
5. Service name: `wolf-warehouse-dashboard-api`.
6. Runtime: **Node**.
7. Branch: `main`.
8. Build command:

```text
npm install
```

9. Start command:

```text
npm start
```

10. Choose the Free instance for testing. For a permanently visible warehouse screen, a paid always-on service is preferable because Render Free services can sleep when idle.

## 2. Add the initial environment variables

In the Render service, open **Environment** and add:

```env
USE_MOCK_DATA=true
DASHBOARD_ACCESS_KEY=replace-with-a-long-private-random-passphrase
ALLOWED_ORIGINS=https://jonwolf1234.github.io
CACHE_SECONDS=55
MAX_OPPORTUNITIES=45
INCLUDE_CUSTOMER_NAME=true
ENABLE_DIAGNOSTICS=false
NODE_VERSION=22
```

Important:

- `ALLOWED_ORIGINS` contains only the origin. Do not add `/wolf-warehouse-dashboard/` to it.
- Use a long passphrase rather than a four-digit PIN.
- The passphrase can include letters, numbers and punctuation.

Save and deploy.

## 3. Test the Render health endpoint

Render will provide a URL similar to:

```text
https://wolf-warehouse-dashboard-api.onrender.com
```

Open this address with `/api/health` added:

```text
https://wolf-warehouse-dashboard-api.onrender.com/api/health
```

Expected result:

```json
{
  "ok": true,
  "service": "wolf-warehouse-dashboard-api",
  "mode": "mock"
}
```

# Part 5 — Connect GitHub Pages to Render

Open `docs/config.js` in VS Code and replace the blank API URL:

```js
window.WAREHOUSE_CONFIG = {
  apiBaseUrl: "https://wolf-warehouse-dashboard-api.onrender.com",
  refreshSeconds: 60,
  defaultDaysAhead: 30,
  companyName: "WOLF",
  screenTitle: "Warehouse Schedule"
};
```

Use your actual Render URL.

Commit and push:

```bash
git add docs/config.js
git commit -m "Connect dashboard to Render API"
git push
```

Open:

```text
https://jonwolf1234.github.io/wolf-warehouse-dashboard/
```

Enter the Render `DASHBOARD_ACCESS_KEY`. The demonstration jobs should appear.

# Part 6 — Create the Current RMS API key

In Current RMS:

1. Open **System Setup**.
2. Open **Integrations → API**.
3. Enable the API if it is not already enabled.
4. Choose **Issue a new API key**.
5. Name it `Warehouse Dashboard`.
6. Save/update the API settings.
7. Copy the generated key somewhere temporarily secure.

Your subdomain is the first part of your Current RMS address. For example:

```text
https://wolf.current-rms.com
```

The subdomain is:

```text
wolf
```

Do not paste the API key into GitHub or `docs/config.js`.

# Part 7 — Connect Render to Current RMS

In Render, open the web service and choose **Environment**.

Add:

```env
CURRENT_RMS_SUBDOMAIN=your-real-subdomain
CURRENT_RMS_API_KEY=paste-the-current-rms-api-key
```

Change:

```env
USE_MOCK_DATA=false
```

Choose **Save, rebuild, and deploy**.

After the deploy finishes, open:

```text
https://wolf-warehouse-dashboard-api.onrender.com/api/health
```

It should now say:

```json
{
  "mode": "current-rms"
}
```

Open the GitHub Pages dashboard and press **Refresh**.

# Part 8 — Confirm the dates and item totals

The starter maps the warehouse dates as follows:

```text
Prep date  → prep_starts_at
Load-out   → load_starts_at
Due back   → unload_starts_at, with collect_starts_at as a fallback
```

It excludes obvious headings, labour, services, transport, sales and text lines from the physical item count. Accessories and rental product quantities are included.

Compare three live Current RMS orders:

1. One not yet prepped.
2. One partly prepped.
3. One fully prepped or booked out.

Check:

- Total quantity
- Prepared quantity
- Prep date
- Load-out date
- Due-back date

# Part 9 — Calibrate prepared quantities if necessary

Current RMS tenants and API versions can expose warehouse quantities using slightly different item fields. The code checks common prepared, booked-out and checked-in quantity/status fields. If the screen shows **Check mapping** or **Prep field not detected**, use the diagnostics endpoint.

## 1. Enable diagnostics temporarily

In Render Environment, change:

```env
ENABLE_DIAGNOSTICS=true
```

Deploy the change.

## 2. Find an opportunity ID

Open an order in Current RMS. The number at the end of the browser URL is normally the opportunity ID.

Example:

```text
https://your-subdomain.current-rms.com/opportunities/123456
```

The ID is `123456`.

## 3. Run the diagnostic request on your Mac

Replace the URL, passphrase and ID:

```bash
curl \
  -H "X-Dashboard-Key: YOUR-LONG-DASHBOARD-PASSPHRASE" \
  "https://wolf-warehouse-dashboard-api.onrender.com/api/diagnostics/opportunity/123456"
```

The response lists detected opportunity keys and a small sample of prep-related item fields. It intentionally focuses on quantity/status fields rather than prices or contact information.

After mapping is confirmed, set:

```env
ENABLE_DIAGNOSTICS=false
```

# Part 10 — Daily warehouse use

## Sort the table

Click any table heading:

- Status
- Job
- Client
- Items
- Prepared
- Prep date
- Load-out
- Due back

Click the same heading again to reverse the order.

## Search

The search box matches:

- Job number
- Job name
- Client
- Status
- Opportunity type

## Search by dates

Choose a date type:

- Any job date
- Prep date
- Load-out date
- Due-back date

Then choose From and To dates. The quick buttons set Today, 7, 14 or 30 days.

## Full-screen warehouse display

Press **Full screen**. The browser may ask for permission the first time.

For a permanently mounted screen, open the browser on startup and save the dashboard passphrase using **Remember on this warehouse screen**.

# Part 11 — Updating the dashboard later

Make changes in VS Code, then run:

```bash
git add .
git commit -m "Describe the change"
git push
```

GitHub Pages will publish changes from `/docs`. Render automatically deploys backend changes from the `main` branch.

# Troubleshooting

## GitHub Pages shows 404

Confirm:

- Settings → Pages is set to `main` and `/docs`.
- `docs/index.html` exists.
- The latest commit is on `main`.

## The dashboard says connection problem

Check:

1. `docs/config.js` contains the exact Render URL.
2. Render is deployed successfully.
3. `ALLOWED_ORIGINS=https://jonwolf1234.github.io`.
4. The passphrase matches `DASHBOARD_ACCESS_KEY` exactly.
5. `/api/health` works.

## Current RMS returns 401

Check:

- The API is enabled.
- The key has not been refreshed/replaced.
- `CURRENT_RMS_SUBDOMAIN` is only the subdomain, not a full URL.
- There are no spaces before or after the API key.

## No jobs appear

Check:

- Increase the date range.
- Confirm upcoming jobs have prep, load, show or return dates.
- Confirm they are orders rather than quotations or cancelled/completed jobs.
- Review Render Logs for a Current RMS API error.

## Render is slow on the first load

A free Render service can spin down when idle and may take time to start again. Use an always-on paid instance for a warehouse display that must respond instantly.

## Troubleshooting: Internal npm registry error

If `npm install` tries to connect to `packages.applied-caas-gateway1.internal.api.openai.org`, delete the supplied lock file and regenerate it against npm's public registry:

```bash
rm -rf node_modules package-lock.json
npm config set registry https://registry.npmjs.org/
npm install
```

The corrected download does not include the internal lock file.
