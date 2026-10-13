# CLAUDE.md

This file gives Claude Code (claude.ai/code) guidance for working in this repository.

## Overview

Internal tool ("adsctrl", package `fb-ads-manager`) for a Vietnamese e-commerce team. It manages Facebook ad accounts and campaigns, including auto pause/resume rules, campaign cloning and spend sync. It also covers Shopee ad accounts and Shopee affiliate ("Shopee Social") orders and commissions, orders synced from Pancake POS and Google Sheets, purchase orders, inventory, "deal stop" orders, return summaries, and AI insights (Claude, OpenAI and Gemini).

- Backend: Node.js, Express 4, Mongoose 8 (MongoDB), BullMQ and ioredis (optional), node-cron. It uses CommonJS.
- Frontend: `client/` uses React 19, Vite, react-router 7, TanStack Table and Virtual, and plain CSS. It uses ESM and JSX with no TypeScript.
- Express serves the built client from `client/dist` and falls back to `index.html` for SPA routes.
- UI strings, logs and code comments are in Vietnamese, usually written **without diacritics**. Match that style.

The top-level `README.md` is outdated. It refers to a `backend/` folder that does not exist.

## Commands

From the repo root:

```bash
npm start                 # node server.js (port from PORT, default 3000)
npm run check             # node --check server.js (syntax check only)
npm run client:build      # build client into client/dist (needed for the server to serve the UI)
npm run client:lint       # eslint on client
npm run redis:start       # Windows: starts local Redis via scripts/start-redis.ps1 (tools/redis, gitignored)
```

Client dev server (it proxies `/api` to `localhost:3000`):

```bash
npm --prefix client run dev
npx --prefix client vite --config vite.local3001.config.js   # proxy to a backend on :3001 instead
```

Production uses pm2 (`ecosystem.config.js`, app name `server`, 6 GB heap).

There is no test suite. To verify a change, run `npm run check` for the server and `npm run client:lint` plus `npm run client:build` for the client. Running `node --check <file>` on individual backend files you edited is also worthwhile.

One-off scripts live in `scripts/`, for example `node scripts/backfillMetaExtra.js [days]`. They connect to `MONGO_URI` directly.

## Backend architecture

### Startup flow (`server.js`)
1. Middleware: perf monitor, CORS, compression, JSON body up to 50 MB, and static `client/dist`. Hashed `/assets` files are cached as immutable, and a missing asset returns 404 rather than `index.html`.
2. `registerFacebookLoginRoutes(app)` registers the public Facebook OAuth routes.
3. `createLegacyRuntime(app)` in `services/legacyRuntimeService.js` registers **all** `/api` routes. See below.
4. A JSON 404 handler for unmatched `/api/*`, the SPA catch-all, and a final JSON error handler.
5. After Mongo connects: `startPosOrderSync()`, then `listen`, then background startup: `runStartupMaintenance`, `bootstrapFacebookToken`, `initializeQueues` (BullMQ), `startCronTasks`, and `resumeAutoAccounts`.
6. SIGINT and SIGTERM trigger a graceful shutdown that stops timers, workers and Mongo.

### The "legacy runtime" (most of the logic lives here)
The app was originally a single huge `server.js`. That code was moved out in large pieces but still relies on a shared lexical scope:

- `services/legacyRuntimeService.js` (~4.3k lines) is the `createLegacyRuntime(app)` closure. It holds the models, in-memory state (per-account scheduler timers, sync jobs, caches), BullMQ queues and workers (`campaign-duplicates`, `campaign-sync-history`, `order-sheet-sync`), Facebook API helpers and auto-rule logic. Inside it:
  - `app.use('/api', authenticateApiRequest)` comes **first**. Any route registered before it is public. Only the routes whitelisted in `middleware/auth.js` (login, OAuth callbacks, `/webhooks/pancake`) should be reachable without auth.
  - `registerAllRoutes(app)` (`routes/index.js`) mounts the newer modular `express.Router` modules: auth, users, config, ai, ai/facebook, deal-stop, google, facebook, fb-profiles.
  - `createLegacyRouteContext()` builds a big deps object. `registerLegacyRoutes(app, deps)` (`routes/legacyRoutes.js`, ~4.8k lines) registers about 60 routes **inside a `with (routeDeps) { ... }` block**, so handlers refer to models and helpers as bare identifiers. This file is sloppy-mode on purpose: never add `'use strict'` to it. A new helper that legacy routes need must be added to the context object in `createLegacyRouteContext`. `routes/pageRoutes.js` is registered from inside that scope.
  - It also calls `registerReportRoutes`, the `registerShopeeSocial*Routes` functions (which take `(app, deps)`), and the crons (final spend at `FINAL_SPEND_CRON`, Shopee reactivate, Facebook token refresh, return-summary warm timer).
- For **new** endpoints, prefer a standalone `express.Router` module (like `routes/dealStopRoutes.js` or `routes/userRoutes.js`) mounted in `routes/index.js`, rather than growing the legacy files.

### Other layers
- `models/`: Mongoose schemas. Key ones are `Account` (`provider`: `facebook` | `shopee`, `ownerUserId`), `Campaign` (per day, `date` is `YYYY-MM-DD`), `Order`, `PurchaseOrder`, `DataPurchaseOrder`, `InventoryItem`, `ShopeeSocialOrder`, `ShopeeAff*`, `User`, `Config` (one global app config), `Log`, and `FacebookToken`.
- `services/`: domain logic. Examples are `posOrderService` (Pancake POS polling and webhook upsert), `orderService`, `purchaseOrderService`, Google Sheet syncs (`inventorySheetService`, `dataPurchaseOrderSheetService`), `facebookTokenService`, `configService` (cached `getAppConfig()`, which must be cleared with `clearAppConfigCache()` after writes) and `userService`.
- `utils/`: `fbApi` (Graph API calls with rate-limit backoff), `timeUtils` (Vietnam time, UTC+7: `todayStr`, `dateKeyFromVnOffset` and others; always use these rather than raw `Date` for date keys), `cacheManager` (in-memory read caches that must be invalidated after writes), `authUtils` (PBKDF2 passwords and HMAC-signed bearer tokens), `googleOAuth`, `csvImport`, `metaExtraMetrics` and `perfMonitor`.
- `lib/`: thin AI provider wrappers (`claudeApi`, `openaiApi`, `geminiApi`) and normalizers.
- `config/appConstants.js`: Facebook and Shopee campaign defaults, Graph API version (`v24.0`), queue and cron settings. Most values can be overridden through env vars and are clamped with `parseBoundedInt`.

### Conventions and gotchas
- **Multi-tenancy:** data is scoped per user through `ownerUserId`. Use `withUserFilter(req, filter)` for queries and `userScopedCacheKey(req, key)` for cache keys. `requireAdminUser(req, res)` gates admin-only routes. `req.currentUser` is set by the auth middleware.
- **Roles and providers:** `User.provider` is one of `facebook`, `shopee`, `oder` (order staff) or `kho` (warehouse). The client shows a different set of routes for each one (`client/src/App.jsx`).
- Error responses are JSON `{ error: message }`. Express 4 does not catch errors from async handlers, so wrap handlers in try/catch.
- Redis is optional. When `REDIS_URL` (or `REDIS_QUEUE_ENABLED`) is set, duplicate, sync-history and order-sheet jobs run through BullMQ and the endpoints return a `jobId` to poll. Otherwise they fall back to inline or in-memory jobs.
- Read-modify-write on the global `Config` document is not atomic. See the serialized write queue in `dealStopRoutes.js`.
- Existing comments often explain *why* a past bug happened (auth ordering, cache leaks between users, unhandled rejections). Read nearby comments before changing such code.

## Frontend architecture (`client/src`)
- `main.jsx` and `App.jsx`: auth gate (`AuthScreen`), lazily loaded pages, and role-based `<Routes>`.
- `contexts/AppContext.jsx`: global state (current user, provider, date range and similar).
- `lib/api.js`: `api(method, path, body, options)` wrapper. It sends the bearer token from `localStorage['adsctrl-token']`, has a 120 s timeout, gives friendly Vietnamese error messages, and caches responses in memory and `sessionStorage` (`readResponseCache`/`writeResponseCache`; call `clearResponseCache()` on logout). The base URL is `VITE_API_URL` or `/api`.
- `pages/`: one file per screen. `ShopeeSocial/` is a feature folder with its own API modules, calculations, file parsing (xlsx) and components.
- `components/`: `Modals/`, `Table/` (virtualized order table), `Toolbar/`, `Settings/` and `Common/`.
- `hooks/`, `utils/` (formatters, Excel export, color rules, column config storage) and `types/` (JSDoc type definitions).

## Environment
`.env` at the repo root is gitignored. The main variables:
- Core: `MONGO_URI`, `PORT`, `AUTH_SECRET`, `AUTH_TOKEN_TTL_MS`, and seed users (`DEFAULT_LOGIN_USERS`, `USER_ADMIN`, `USER_*_PASSWORD`).
- Facebook: `FB_APP_ID`, `FB_APP_SECRET`, `FB_OAUTH_REDIRECT_URI`, `FB_LONG_LIVED_USER_ACCESS_TOKEN`, `FB_GRAPH_API_VERSION` and `FACEBOOK_TOKEN_CRON`.
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `INVENTORY_SHEET_*` and `DATA_PURCHASE_ORDERS_*`.
- Pancake POS: `PANCAKE_API_KEY`, `PANCAKE_SHOP_ID`, `POS_SYNC_*` and `ORDERS_SOURCE`.
- Redis and queues: `REDIS_URL`, plus `CAMPAIGN_*`, `ORDER_SHEET_SYNC_*` and `*_SYNC_INTERVAL_MS`.
- Perf: `PERF_MONITOR` and `PERF_*`.
