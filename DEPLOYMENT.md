# ActiveBits Deployment Guide

This guide covers deploying ActiveBits to Render.com with Valkey (Redis-compatible) session storage for persistence across deployments and horizontal scaling.

## Architecture Overview

### Session Storage Modes

ActiveBits supports two session storage modes:

1. **In-Memory Mode** (Development/Testing)
   - No external dependencies
   - Sessions lost on restart
   - Fast performance
   - Automatic when `VALKEY_URL` is not set

2. **Valkey Mode** (Production)
   - Persistent session storage
   - Survives hot redeployments
   - Supports horizontal scaling
   - Redis pub/sub for cross-instance coordination
   - Automatic when `VALKEY_URL` is set

### Components

- **Session Store**: Temporary session data (1-hour TTL)
- **Session-store selection logging**: Startup emits a structured `session-store` / `store-selected` event identifying the in-memory or Valkey-backed mode; use this event when confirming deployed storage configuration.
- **Persistent Metadata**: Waiting room state (10-minute TTL)
- **WebSocket Keepalive Cache**: In-memory cache (30s TTL) for reducing Valkey traffic
- **Pub/Sub Channels**: Cross-instance broadcasting for session events
- **JSON request body budget**: Most routes keep Express's default JSON body limit. Only the `/api/mobcode` route prefix uses an `8mb` parser budget, and MobCode file-state payloads are capped lower at `4 MiB` after parsing.
- **MobCode student-code retention**: Live student workspaces are retained in the MobCode session record. Each student workspace is capped at 512 KiB; MobCode retains at most 30 student workspaces and 20 MiB of aggregate student-code data. Operators should ensure the backing session store supports records of this size.

## Render.com Deployment

### Prerequisites

- Render.com account
- GitHub repository with ActiveBits code
- Node.js 24.x environment

### Step 1: Create Valkey Instance

1. Go to Render Dashboard
2. Click **New** → **Redis**
3. Configure:
   - **Name**: `activebits-valkey`
   - **Plan**: Choose based on expected load (Starter plan works for small deployments)
   - **Region**: Same as your web service for low latency
4. Click **Create Redis**
5. Wait for provisioning to complete
6. Copy the **Internal Redis URL** (format: `redis://red-xxxxx:6379`)

### Step 2: Create Web Service

1. Go to Render Dashboard
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `activebits`
   - **Region**: Same as Valkey instance
   - **Branch**: `main` (or your deployment branch)
   - **Runtime**: Node
   - **Build Command**: `npm install --include=dev --workspaces --include-workspace-root && npm run build --workspace client && npm run build --workspace server`
   - **Start Command**: `cd server && npm start`
   - **Plan**: Choose based on expected traffic (Starter plan for testing, Standard+ for production)

   **TypeScript server runtime policy (current)**:
   - `npm run build --workspace server` runs `tsc -p server/tsconfig.build.json` and emits `server/dist/server.js` from `server/server.ts` plus other `server/**/*.ts` modules.
   - `npm start` runs compiled output (`dist/server.js`) when present, and falls back to TS runtime (`node --import tsx server.ts`) when dist output is absent.
   - Production expectation remains compiled runtime (`node dist/server.js`).

5. **Environment Variables**:
   ```
   NODE_ENV=production
   VALKEY_URL=<paste-internal-redis-url-from-step-1>
   PERSISTENT_SESSION_SECRET=<generate-random-32+-char-string>
   SESSION_TTL_MS=3600000
   HOST=0.0.0.0 
   ```

   **Important**: Generate a strong random secret for `PERSISTENT_SESSION_SECRET`:
   ```bash
   # Generate a secure secret (run locally)
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. **Advanced Settings**:
   - **Health Check Path**: `/health-check`
   - **Auto-Deploy**: Yes (for continuous deployment)

7. Click **Create Web Service**

### Step 3: Enable Session Affinity (Sticky Sessions)

**Critical for WebSocket connections when scaling horizontally!**

1. In your web service settings, go to **Settings** → **Scaling**
2. If you plan to scale beyond 1 instance:
   - Contact Render support to enable session affinity
   - Or use Render's proxy with sticky sessions
   - Or accept that WebSocket clients may need to reconnect on rebalancing

**Note**: For single-instance deployments, sticky sessions are not required.

### Step 4: Verify Deployment

1. Wait for the build to complete
2. Check logs for:
   ```
   Using Valkey session store with caching
   Using Valkey for persistent session metadata
   ActiveBits server running on http://0.0.0.0:3000
   ```
3. Visit your Render URL (e.g., `https://activebits.onrender.com`)
4. Test health check: `https://activebits.onrender.com/health-check`
5. Before creating a session, open `/manage` and verify the **Activity Dashboard** heading plus the **Mob Code** card with **Start Session Now** and **Create Permanent Link** controls. These are rendered from the activity registry by [`ManageDashboard`](client/src/components/common/ManageDashboard.tsx).
6. Start a test session from the Mob Code card and verify it persists after redeployment.

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VALKEY_URL` | No | (none) | Valkey/Redis connection URL. If not set, uses in-memory storage. |
| `NODE_ENV` | No | `development` | Set to `production` for production deployment. |
| `PERSISTENT_SESSION_SECRET` | **Yes** | (dev fallback only) | HMAC secret for persistent session links. Production startup fails if missing or weak. |
| `SESSION_TTL_MS` | No | `3600000` | Session TTL in milliseconds (default: 1 hour). |
| `PORT` | No | `3000` | Server port (Render sets this automatically). |

| `LEARN_SYNCDECK_HMAC_SECRET` | Conditional | (none) | Dedicated shared secret for the Learn SyncDeck server-to-server integration. Leave unset to disable the integration. Never reuse an LTI consumer secret. |
| `LEARN_SYNCDECK_HMAC_KEY_ID` | No | `learn-default` | Identifies the active Learn SyncDeck HMAC key. Use a new key ID during rotation. |

Learn substitute-instructor capability URLs are signed bearer links. Configure reverse
proxy and access logging to redact their query strings, and use bounded expiration when
issuing them from Learn.

Learn student waiting-room launches embedded in an LMS use a `Secure; SameSite=None; Partitioned` httpOnly handoff cookie so the ActiveBits iframe can poll its same-origin
waiting-room status endpoint without requiring a global third-party cookie. Production
must therefore use HTTPS.

## Source Map Policy (Open-Source Repo)

ActiveBits intentionally ships source maps in production for debugging and teaching transparency.

1. **Client source maps**:
   - Enable Vite production source maps (`build.sourcemap: true`).
   - Publish generated `.map` files with client assets.

2. **Server source maps (post-TypeScript migration / TS server emit available)**:
   - Keep `sourceMap: true` in `server/tsconfig.build.json`.
   - Deploy emitted `.map` files with `server/dist`.

3. **Operational verification**:
   - Confirm `.map` files are present in deployment artifacts.
   - Verify stack traces map to original TypeScript source during incident debugging.

## Bundled Client Runtime Assets

- The shared QR scanner uses `react-zxing` with the `zxing-wasm` reader binary imported through Vite. Production client builds emit `zxing_reader-*.wasm` under `client/dist/assets/`; deploy that file with the rest of the built client assets so QR scanning does not fall back to a third-party CDN.
- Deploy every generated file under `client/dist/assets/`, not only the activity entry chunks. MobCode lazy-loads its role views, editor, ZIP support, and runner renderer into separate hashed chunks after the initial activity shell.

## Excluded Development Assets

SyncDeck sample decks under `activities/syncdeck/dev-presentations/` are local-only and must not be emitted by production builds.

## SyncDeck Embedded Media

- SyncDeck's internal embedded-activity iframes delegate `autoplay` and `fullscreen` so synchronized, muted media players (including Video Sync's nested YouTube player) can start from an instructor playback command. Keep this iframe permission policy intact when configuring a reverse proxy or content-security policy.
- SyncDeck processes instructor websocket updates in arrival order before persisting session state. Deployments with Valkey should retain this single-connection ordering behavior; no additional proxy affinity setting is required beyond the websocket guidance above.

## Scaling Considerations

### Single Instance (Default)

- No special configuration needed
- Valkey provides persistence across redeployments
- All WebSocket connections handled by one instance

### Multiple Instances (Horizontal Scaling)

When scaling to multiple instances:

1. **Session Affinity**: Enable sticky sessions to route WebSocket connections to the same instance
2. **Pub/Sub**: Already configured via Valkey for cross-instance broadcasts
3. **Cache Coordination**: Each instance maintains its own keepalive cache; pub/sub handles consistency
4. **Persistent Sessions**: Shared via Valkey; waiters are instance-local
5. **Teacher/manager credential recovery**: Keep the `persistent_sessions` httpOnly cookie path and same-site behavior intact, since activities such as SyncDeck and Video Sync recover manager credentials from a teacher-validated persistent-session cookie after redirects into `/manage/...`. Dashboard-created Video Sync sessions receive an httpOnly manager capability cookie from `POST /api/video-sync/create`; do not persist manager credentials in browser storage.
   The separate `activebits_student_display_name` cookie is JavaScript-readable by design and contains only a student's display name; preserve its site-wide path and `SameSite=Lax` behavior, but do not reuse it for identities, authentication, or sensitive fields.
   The remembered persistent-session entries are bounded by both count and percent-encoded serialized cookie bytes. Keep this compaction in place: browsers can silently reject oversized cookies, which otherwise makes teachers repeatedly re-enter valid codes and prevents SyncDeck persistent-manager recovery. An individually oversized remembered entry is omitted without evicting older valid entries.
6. **SyncDeck teacher redirects**: Teacher entry into started SyncDeck permalinks must strip the permalink query before redirecting to `/manage/syncdeck/:sessionId`. The manager recovers the authoritative deck URL and canonical permalink state from the session/cookie path instead of trusting stale or unsigned permalink query params on the manage route.
   Temporary SyncDeck manager creation also adds a session-scoped token to a bounded browser-session httpOnly recovery cookie. Preserve same-origin cookie forwarding, the `/api/syncdeck` cookie path, `SameSite=Lax`, and the production `Secure` flag so a reload can recover instructor control without putting a passcode in browser storage. The server session's sliding TTL, not a fixed cookie expiry, remains authoritative.
7. **Video Sync unsynced-student telemetry**: In Valkey mode, `video-sync` stores per-session unsynced-student timestamps in a Valkey-backed key (with short TTL pruning) so `telemetry.sync.unsyncedStudents` stays coherent when `/api/video-sync/:sessionId/event` requests land on different instances. In in-memory mode this telemetry remains single-instance only, which is acceptable for local/dev deployments.
   Video Sync session mutations use `SessionStore.updateAtomic(...)`: Valkey performs compare-and-set against a session mutation revision **and the session incarnation (`created`)** and the store retries a conflicting mutation from a fresh snapshot. The `created` term closes an ABA hole: a same-id delete+recreate resets `mutationRevision` to `0`, so a stale replacement could otherwise pass a revision-only CAS and overwrite the fresh incarnation. Heartbeats, telemetry, socket admission/cleanup, configuration, capability issuance, and playback commands therefore cannot overwrite a command committed by another instance, nor land on a session that was recreated mid-flight. Playback commands also increment a separate public `playbackRevision`; clients reject lower revisions regardless of wall-clock timestamps. Command IDs are retained in a bounded de-duplication window so the manager can safely retry an ambiguous network failure. A Valkey outage remains a retryable 500 or a skipped/logged heartbeat rather than falling back to cached state. The in-process read cache guards every async fill (`SessionCache.replaceStaleFill`) with a monotonic per-id write generation: a fill lands only if the generation is unchanged since the caller captured it before its await, or a same-incarnation `mutationRevision` proves it newer — no cross-incarnation wall-clock comparison — so a read that raced behind a newer commit, a recreated incarnation, or a `delete` cannot roll `get()` back (or resurrect a deleted session) for the 30s cache TTL.
   CAS identity compatibility is fail-closed when the caller supplies `expectedCreated`: the stored record must contain the same value. Only a caller that read a legacy record without an identity uses revision-only matching.
   When an async cache fill races a write, an equal `mutationRevision` is not evidence that the fill is current because a legacy/plain whole-record write can retain its revision. The cache accepts a raced fill only when it has a strictly greater revision within the same incarnation.
8. **Embedded child bootstrap payloads**: SyncDeck embedded launches now persist child-session bootstrap data under `session.data.embeddedLaunch.selectedOptions`. That session record must survive reloads and hot redeploys because embedded managers such as Video Sync rehydrate launch intent from the sanitized `GET /api/session/:childSessionId/embedded-launch` endpoint. In production, validate that this route remains available after deploys and returns only `{ embeddedLaunch: { selectedOptions } }`, not the raw session record.
9. **SyncDeck embedded-session keepalive coupling**: launched embedded child sessions are expected to stay alive while their parent SyncDeck session is still active, and child-session reads now refresh the parent too. In production, treat unexpected pruning of either side as a keepalive regression rather than as normal temporary-session expiry.
10. **Canonical persistent-link recovery**: Persistent manager recovery routes that return bootstrap data (for example Video Sync `persistentSourceUrl`) should source that data from canonical remembered permalink `selectedOptions` rather than from raw query params on redirected manage routes.
11. **Linked-session refresh scope**: `data.linkedSessionId` refreshes only the directly linked record. Do not depend on transitive refreshes; keeping the relationship single-hop prevents a malformed cycle from blocking a keepalive request. For active Learn entries, this store TTL is authoritative; do not introduce a second logical expiry that can reject a still-live mapping. In Valkey mode, source data is revalidated on a bounded five-second cadence before propagation, so a Stop handled on another instance is observed without turning every websocket event into a Valkey read.
12. **Shared activity capability cookies (Java Format Practice, Slice A of the shared-activity-runtime migration)**: Session creation now issues an opaque, httpOnly manager capability cookie (`activebits_cap_manager_<base64url(sessionId)>`, `SameSite=Lax`, `path=/`, `Secure` in production, ~7-day `maxAge`). Accepted waiting-room participants get an httpOnly `activebits_participant_<base64url(sessionId)>` cookie. Only SHA-256 hashes of these tokens are stored in the session record, and capabilities carry a bounded server-side `expiresAt` (default 7 days) that is enforced on resolution independently of the browser cookie lifetime. Preserve same-origin cookie forwarding, the `/` cookie path, and the production `Secure`/TLS termination so managers and students recover on reload without any token in browser storage. This is a **clean cutover**: sessions created before the deploy have no capability records and will 403 / close `1008 activity-auth-required` on manager and participant surfaces — expected, no migration path. The Java Format **permalink / persistent-teacher** entry path is now wired: `activity.config.ts` sets `supportsPermalink: true` for `java-format-practice`, and its manager view redeems the verified `persistent_sessions` teacher cookie for a manager capability through `POST /api/session/:sessionId/persistent-manager-capability` before any capability-gated REST call or WebSocket connect. That recovery route requires an HMAC-validated `persistent_sessions` cookie entry for the link's `activityName:hash` and a live persistent session whose `sessionId` and `activityName` match the target; it persists the capability before writing the cookie and returns a controlled 500 (no cookie) if the session store write fails. A temporary manager still holding its `POST /create` capability short-circuits that call with a 200 via the `alreadyAuthorized` fast path; the 404 there is only reached once that capability is missing/expired *and* the session has no persistent hash, so it never appears on the normal temporary-session mount flow. Temporary-session creation, waiting-room entry, and solo play via the home card / direct path are unaffected. The manager UI's **End Session** control still calls the activity-agnostic `DELETE /api/session/:sessionId`, which remains authorized by session ID only (tracked as a known gap for the Phase 3 shared lifecycle-route primitive); the difficulty/theme/roster/stats routes and the sockets are capability-gated. The manager cookie is issued **per session** at `path=/`, so an instructor who creates many sessions in one browser without clearing cookies accumulates one ~7-day cookie per session until browser eviction; choosing between per-session cookies, a bounded single-cookie collection, and a short-lived handoff exchange is the open Phase 1 decision in `.agent/plans/shared-activity-runtime-authentication.md` (temporary manager capability shape) and will be settled before the shared primitive ships.
13. **Resonance timeout finalization**: When a timed active run expires, an in-process server deadline task promotes every valid server-persisted draft from that run into a submitted response before clearing the active questions and broadcasting the result. Loading a future-deadline session re-establishes this task after a restart or reconnect; normal session access remains a fallback expiration trigger. Long waits are segmented at Node's maximum timer delay, and a failed strict store read or persist re-arms the task instead of dropping finalization. Student clients cap their draft debounce to flush shortly before the deadline, and no client-supplied late-submit flag is trusted. Resonance still uses whole-session writes; horizontal scale-out safety depends on migrating all Resonance mutations to `SessionStore.updateAtomic(...)` under #313 before enabling multiple writers for one session.
14. **Resonance participant capabilities**: Resonance registration issues an opaque, httpOnly `activebits_cap_participant_<base64url(sessionId)>` cookie with the shared seven-day bounded server expiry. An already-authenticated registration reload reuses that capability rather than minting another record. Student REST state/submission routes and WebSocket admission derive the student ID from that capability; query/body IDs are consistency checks only. Waiting-room IDs can be claimed only when the existing accepted-participant cookie proves the same identity, while direct entry receives a new server-generated ID. This is a clean cutover: pre-deployment live sessions without Resonance participant capabilities are not migrated. Preserve same-origin cookie forwarding, `path=/`, and production TLS so `Secure` cookies reach both REST and WebSocket upgrades.

**To scale horizontally**:
1. Go to **Settings** → **Scaling**
2. Increase instance count
3. Ensure session affinity is enabled
4. Monitor Valkey connections (each instance creates 2 connections: regular + pub/sub)

## Hot Redeployment Behavior

When a new deployment is triggered:

1. **Graceful Shutdown** (30s timeout):
   - Server stops accepting new connections
   - Flushes in-memory cache to Valkey
   - Closes Valkey connections gracefully
   - WebSocket clients receive disconnect

2. **Client Reconnection**:
   - Clients automatically reconnect to new instance
   - Session data restored from Valkey
   - Student progress preserved

3. **Zero Data Loss**:
   - Periodic cache flush (every 30s)
   - Final flush on SIGTERM
   - TTL extends on reconnection

## Monitoring

### Key Metrics to Monitor

1. **Valkey Connection Health**:
   - Check `/health-check` endpoint
   - Monitor Valkey dashboard on Render
   - Watch for connection errors in logs

2. **Session Count**:
   - Valkey keys with prefix `session:*`
   - Valkey keys with prefix `persistent:*`

3. **Runtime Status Endpoints**:
   - `GET /health-check` — Basic liveness + process memory
   - `GET /api/status` — Detailed JSON (storage mode, TTLs, process metrics, WebSocket clients, sessions summary, Valkey info)
   - `GET /status` — HTML dashboard that auto-updates, useful for quick checks during deployment or incidents

4. **Cache Hit Rate**:
   - Not exposed by default; add custom metrics if needed
   - Effective cache reduces Valkey read operations

5. **WebSocket Connections**:
   - Monitor active WebSocket count
   - Check reconnection patterns after deployment

### Troubleshooting

**Symptoms**: Sessions lost after deployment
- **Cause**: `VALKEY_URL` not set
- **Fix**: Set environment variable and redeploy

**Symptoms**: "Teacher code invalid" after deployment
- **Cause**: `PERSISTENT_SESSION_SECRET` changed
- **Fix**: Use same secret across deployments (never rotate during active sessions)

**Symptoms**: WebSocket disconnects frequently
- **Cause**: Scaling without session affinity
- **Fix**: Enable sticky sessions or use single instance

**Symptoms**: Status dashboard shows "not using Valkey" unexpectedly
- **Cause**: `VALKEY_URL` missing or misconfigured; container cannot reach Valkey
- **Fix**: Verify `VALKEY_URL` (use internal URL on Render), check Valkey instance health; confirm `/api/status` shows `mode: valkey` and Valkey `ping: PONG`

**Symptoms**: SyncDeck student view reports blocked insecure content or `postMessage` target-origin errors against an HTTP presentation URL
- **Cause**: ActiveBits is running on HTTPS, but the configured presentation URL is an HTTP origin that the browser does not treat as loopback-secure. Browsers block those mixed-content iframes, so the deck never loads in the student iframe.
- **Fix**: For normal hosted decks, serve the presentation over HTTPS as well. Loopback testing URLs such as `http://localhost` and `http://127.0.0.1` may work in some browsers, but non-loopback HTTP origins will not.

**Symptoms**: A YouTube player embedded through a SyncDeck manager reports error 153 (client identity/referrer error)
- **Cause**: The nested YouTube iframe must receive either a referrer or the player origin. A `no-referrer` policy on the SyncDeck manager iframe prevents both in Safari.
- **Fix**: Keep SyncDeck's embedded-manager iframe policy at `strict-origin-when-cross-origin` and the client document policy at `strict-origin`. Together they send only the ActiveBits origin to YouTube—never the child manager URL or its one-time entry token. If the browser has a content blocker, allow YouTube resources for the ActiveBits site as well.

**Symptoms**: High Valkey latency
- **Cause**: Valkey instance in different region or overloaded
- **Fix**: Move Valkey to same region, upgrade plan, or reduce TTL/cache flush frequency

## Operational Tuning

1. Increase cache TTL to reduce Valkey reads (trade: longer stale data window)
2. Reduce session TTL if users don't need long sessions
3. Use single instance if horizontal scaling not needed
4. Monitor Valkey memory usage; evict old sessions if needed

## Security Best Practices

1. **HTTPS Only**: Render provides automatic HTTPS
2. **Secure Cookies**: Enabled in production via `NODE_ENV=production`
3. **Strong Secrets**: Use 32+ character random strings for `PERSISTENT_SESSION_SECRET`
4. **Rate Limiting**: Built-in for teacher code attempts (5 attempts/minute per IP+hash)
5. **Reverse Proxy**: In production, the server trusts one proxy hop so Render-forwarded client IPs feed IP-based rate limits.
6. **Valkey Access**: Use internal URLs only (not publicly accessible)

## Backup and Recovery

### Session Data
- **Ephemeral**: Sessions expire after TTL (default 1 hour)
- **No backup needed**: Designed for temporary interactive sessions
- **Recovery**: Students can rejoin with same name/ID

### Persistent Links
- **Stored in cookies**: Teacher codes stored client-side
- **Exportable**: `/api/persistent-session/list` returns all user's sessions
- **No server backup needed**: Links regenerated from teacher code + activity name

## Migration from In-Memory to Valkey

To migrate an existing deployment:

1. Create Valkey instance (Step 1 above)
2. Add `VALKEY_URL` environment variable
3. Redeploy
4. **Warning**: All active sessions will be lost during this transition
5. Future sessions will persist across redeployments

## Changelog

- **2024-12**: Initial Valkey integration with pub/sub support
- **2024-12**: Added keepalive caching layer for performance
- **2024-12**: Implemented graceful shutdown for hot redeployments (WebSockets now drain in ~1s before the process exits)
