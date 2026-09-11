# Security Notes

Track security-relevant boundaries, risks, and mitigation decisions.

## Entry Template

- Date:
- Area:
- Threat or risk:
- Control or mitigation:
- Residual risk:
- Validation (test/review/path):
- Follow-up action:
- Owner:

## Notes

- Date: 2026-09-11
- Area: Resonance student REST and WebSocket authority
- Threat or risk: Resonance previously trusted a student ID supplied in a REST body/query or WebSocket URL, allowing a caller who learned another ID to read that student's retained answers/private feedback or mutate their response.
- Control or mitigation: Registration now issues the shared opaque participant capability as an httpOnly, session-scoped cookie. REST state/submission handlers and WebSocket admission resolve the authoritative student from that cookie and reject mismatched client hints. Waiting-room IDs additionally require the accepted-entry participant credential; direct entry receives a server-generated ID.
- Residual risk: Resonance session mutations remain whole-record writes under the single-writer deployment constraint pending the complete #313 atomic migration. The shared waiting-room participant-token mint boundary remains tracked separately under #352. This is intentionally a clean cutover with no pre-deployment live-session credential migration.
- Validation (test/review/path): `activities/resonance/server/routes.ts`; `activities/resonance/server/routes.test.ts`; `activities/resonance/playwright/auth.spec.ts`; #341.
- Follow-up action: Close #341 when PR #372 merges.
- Owner: Codex

- Date: 2026-08-29
- Area: shared activity runtime authority boundary
- Threat or risk: Activities independently treated session IDs, request participant IDs,
  display names, and WebSocket roles as authority, exposing inconsistent manager,
  participant, and projection boundaries across HTTP and socket transports.
- Control or mitigation: The completed repository audit defines a versioned shared
  principal/capability/projection contract in
  `.agent/knowledge/activity-runtime-threat-model.md`. It requires opaque httpOnly
  capabilities, server-resolved principals before handler or socket admission,
  activity-owned projections, and audience-preserving delivery.
- Implemented so far (Slice A, PR #349): shared hashed capability + accepted-entry
  primitives (`server/core/activityCapabilities.ts`, bounded server-side expiry;
  `server/core/acceptedEntryParticipants.ts`, hashed tokens). Java Format Practice
  creation issues the manager capability cookie; its manager REST routes
  (`/difficulty`, `/theme`, `/students`) and the manager WebSocket require that
  manager capability cookie, while `POST /stats` and the participant WebSocket
  require the accepted-participant cookie; sockets authenticate before
  subscription/snapshot. Clean cutover: pre-deployment sessions are rejected on
  migrated surfaces with no fallback.
- Residual risk: Most activities are still activity-local until migrated in focused
  PRs (Slices B/C, Phase 7 waves). Java Format's permalink / persistent-teacher
  entry does not yet issue a manager capability (needs the Slice C persistent
  adapter; tracked in #351). The public waiting-room store
  (`server/core/entryParticipants.ts`) still accepts a request-supplied
  `participantId`, so a caller who knows another participant's id can mint an
  accepted-participant cookie for it; a blunt server-only mint breaks SyncDeck's
  embedded-activity identity handoff, so the real fix is a trusted embedded
  handoff path (Slice C / #352). The separately tracked raw shared-session
  disclosure advisory is out of scope.
- Validation (test/review/path): `.agent/knowledge/activity-runtime-audit.md`;
  `.agent/knowledge/activity-runtime-threat-model.md`;
  `.agent/plans/shared-activity-runtime-authentication.md`;
  `activities/java-format-practice/server/routes.test.ts`;
  `server/core/activityCapabilities.test.ts`.
- Follow-up action: Prove the REST-only (Slice B) and multi-mode / persistent
  adapter (Slice C) contracts, then retrofit Java Format permalink auth (#351)
  before Phase 7.
- Owner: Codex

- Date: 2026-07-26
- Area: Learn SyncDeck substitute instructor link
- Threat or risk: A direct substitute link is a bearer capability that can start or reuse
  an instructor-led SyncDeck session without LMS access.
- Control or mitigation: ActiveBits verifies an expiry-bound, canonical base64url payload
  signed with a domain-separated HMAC context, establishes only httpOnly instructor
  recovery state, and redirects to a token-free manager URL with no-referrer/no-store
  headers. It does not log the link payload or signature.
- Residual risk: The signed payload is not encrypted and the stateless initial design
  cannot revoke an individual link before expiry.
- Validation (test/review/path): `activities/syncdeck/server/learnIntegration.ts`;
  `activities/syncdeck/server/learnIntegration.test.ts`;
  `activities/syncdeck/playwright/substitute-instructor-link.spec.ts`.
- Follow-up action: Use a short class/day expiry from Learn when generating links.
- Owner: Codex

- Date: 2026-08-07
- Area: Learn SyncDeck identity-fingerprint logging (session-split investigation)
- Threat or risk: A session-split incident (instructor editor showed an active session/join
  code; a student's launch with the same intended placement was handed off to a waiting
  room; the instructor's later reopen landed in a separate session the student had started)
  could not be traced after the fact, because `status`/`student-entry` logged nothing on
  success and no log line captured `provider`, `resourceLinkId`, or the computed mapping id
  needed to tell whether the three requests resolved to the same internal identity.
- Control or mitigation: Added `learn-identity-resolved` log lines (and inline fingerprint
  fields on the existing `learn-instructor-session-start-pending` log) to `status`,
  `student-entry`, `start`, and `stop`. Each line records `operation`, resolved `state`,
  `reused` (for `student-entry`/`start`), and three **non-reversible** fingerprints —
  `providerFingerprint`, `resourceLinkFingerprint`, `mappingFingerprint` — plus a
  `sessionFingerprint` for the internal SyncDeck session, all derived via a domain-separated
  HMAC-SHA256 (truncated to 16 hex chars) keyed by the same shared Learn HMAC secret used for
  request signing. Raw `provider`, `resourceLinkId`, the internal mapping id, and internal
  session ids are never included in these lines; handoff/launch URLs and browser tokens are
  never logged. See `identityFingerprint`/`identityFingerprints`/`logIdentityResolution` in
  `activities/syncdeck/server/learnIntegration.ts`.
- Residual risk: Fingerprints are stable only as long as the shared HMAC secret is unchanged;
  rotating the secret makes historical and post-rotation fingerprints for the same identity
  incomparable (expected — same tradeoff as `mappingId` itself). Fingerprints reveal identity
  *equality/inequality* across log lines, not the underlying values, by design.
- Validation (test/review/path): `activities/syncdeck/server/learnIntegration.test.ts` (asserts
  fingerprint stability across `student-entry`/`start`/`status`/`stop` calls for the same
  resource, divergence for a different `resourceLinkId`, and that `learn-identity-resolved`
  lines never contain the raw resourceLinkId, session id, or handoff/token material).
- Follow-up action: Learn is adding a matching fingerprint scheme on their side (see the
  `learn-provider`/`learn-resource-link`/`learn-mapping` domain-separation contract in
  `.agent/knowledge/data-contracts.md`) so calls can be correlated across both systems without
  either side logging raw identity values. If a future incident needs finer-grained tracing,
  extend `logIdentityResolution` call sites rather than logging raw values.
- Owner: Codex

- Date: 2026-08-08
- Area: Learn SyncDeck entry-mapping TTL (session-split root cause)
- Threat or risk: Root-caused the session-split class from the entry above to two compounding
  bugs, neither requiring any `provider`/`resourceLinkId` mismatch: (1) the active-entry TTL
  fallback `sessions.ttlMs ?? WAITING_TTL_MS` in `learnIntegration.ts` silently resolved to the
  10-minute `WAITING_TTL_MS` in production, because the Valkey-backed store returned by
  `createSessionStore()` never exposes a top-level `ttlMs` (only `InMemorySessionStore`, used
  without `VALKEY_URL`, has one; `server/routes/statusRoute.ts` already had to work around this
  same gap). (2) Even at the intended ~1h value, the entry's expiry was refreshed only by Learn
  REST calls (`status`/`student-entry`/`start`/`stop` -> `loadEntry`), never by the live
  SyncDeck session's own websocket activity — so an entry could silently expire out of the store
  mid-class while the session it pointed at was genuinely live and busy (confirmed against an
  incident where an embedded videosync child had just run under the "orphaned" session). Once
  the entry was gone, the next student launch created a fresh waiting entry under the same
  identity, and the instructor's next `start`/reopen created a brand-new session under that
  entry — splitting the class exactly as observed, entirely independent of the identity-mismatch
  hypothesis in the entry above.
- Control or mitigation: (1) Added `resolveActiveEntryTtlMs()` in `learnIntegration.ts`, which
  checks `sessions.ttlMs`, then `sessions.valkeyStore?.ttlMs`, before falling back to
  `WAITING_TTL_MS`, replacing all three `sessions.ttlMs ?? WAITING_TTL_MS` call sites (`start`'s
  create branch, the substitute-instructor-link create branch, and `loadEntry`'s refresh calc).
  (2) Added a generic, activity-agnostic `linkedSessionId` convention to `server/core/sessions.ts`
  (parallel to the existing `embeddedParentSessionId` pattern): any session may declare
  `data.linkedSessionId`, and `SessionStore.touch()` (both `InMemorySessionStore` and the
  Valkey-wrapped store) propagates a touch to that linked record. `learnIntegration.ts` now
  stamps the live SyncDeck session with `data.linkedSessionId = <entry mapping id>` via
  `linkLiveSessionToEntry()` whenever `start` or the substitute-link route creates a session.
  Since `wsRouter.ts`'s existing 30s ping loop already calls `sessions.touch(ws.sessionId)` on
  any connected instructor/student/embedded-child socket, the entry now stays alive for as long
  as anyone is actually connected to the class session, independent of whether Learn ever polls
  `status` again.
- Residual risk: Sessions created before this change lack `linkedSessionId` and won't benefit
  from propagation until they naturally end and a new one is created (no migration needed — the
  old poll-driven refresh path still applies to them). The entry still has no live-session
  connection during the window between `start` creating it and the first client connecting; the
  TTL value fix (1) covers that window, not propagation (2).
- Validation (test/review/path): `server/sessionStore.test.ts` (`linkedSessionId` touch
  propagation, and an entry surviving past its own ttl purely via a linked session being
  touched, with a negative control); `activities/syncdeck/server/learnIntegration.test.ts`
  (`linkedSessionId` stamped on the live session after `start`; active-entry `expiresAt`
  resolves from `valkeyStore.ttlMs` when the wrapped store's top-level `ttlMs` is undefined).
- Follow-up action: If a future activity needs the same "entry mapping tied to a live session's
  actual connectivity" shape, reuse the `linkedSessionId` convention rather than inventing a new
  one — see the generic contract in `.agent/knowledge/data-contracts.md`.
- Owner: Codex

## Learn pending-start logging and linked-session safety

- Date: 2026-08-08
- Finding: The `learn-instructor-session-start-pending` event previously included raw `resourceLinkId`, despite the fingerprint-only logging contract. The linked-session helper also needed to avoid recursive traversal so malformed `A -> B -> C` and `A <-> B` links cannot refresh beyond one hop or recurse indefinitely.
- Resolution: The pending event now retains `requestId`, state, and identity fingerprints but omits the raw resource identifier. Both in-memory and Valkey-backed session stores use a non-propagating direct refresh for `linkedSessionId` targets.
- Validation: `activities/syncdeck/server/learnIntegration.test.ts` parses the pending event and verifies the raw field is absent; `server/sessionStore.test.ts` covers chain and two-record-cycle behavior plus a widened expiry margin.
- Owner: Codex

## Learn active-entry expiry and lifecycle logging

- Date: 2026-08-08
- Contract: Waiting Learn entries retain their bounded `data.expiresAt` gate. Active entries rely on the underlying session-store TTL, refreshed through the single-hop live-session link, so a stale logical timestamp cannot split an active class from its mapping.
- Privacy: Learn lifecycle audit events use provider/resource/mapping/session fingerprints rather than raw identifiers. Exact tests lock the cross-system HMAC vector from `.agent/plans/learn-syncdeck-session-integration.md`.
- Owner: Codex

- Date: 2026-07-15
- Area: waiting-room student display-name persistence
- Threat or risk: Remembering a student's lobby name across days in browser persistence could inadvertently expand into storing participant IDs, credentials, or activity-specific form data.
- Control or mitigation: The shared waiting room writes only the trimmed `displayName` to the JavaScript-readable `activebits_student_display_name` cookie, scoped to `/`, `SameSite=Lax`, one-year expiry, and `Secure` on HTTPS. All other waiting-room values retain their existing session-only persistence.
- Residual risk: The display name remains readable by same-origin JavaScript and by anyone with access to the browser profile; it is deliberately not an authentication or identity signal.
- Validation (test/review/path): `client/src/components/common/waitingRoomFormUtils.ts`; `client/src/components/common/waitingRoomFormUtils.test.ts`.
- Follow-up action: If product requirements add remembered student identity beyond a display name, design a server-issued, privacy-reviewed identity mechanism rather than adding fields to this cookie.
- Owner: Codex

- Date: 2026-07-13
- Area: SyncDeck embedded manager bootstrap recovery
- Threat or risk: A consumed or stale one-time child-manager token can leave an iframe without instructor credentials; passing a replacement token or passcode through an unverified child message would expand the credential exposure surface.
- Control or mitigation: The child posts only `{ type, childSessionId }` to its same-origin parent after failed exchange. The parent validates the origin, verifies the sending iframe window and embedded record, and rejects authenticated-start responses whose `instanceKey` differs from the requested instance before invalidating local bootstrap state or caching credentials. The child caps refresh requests per session, and the parent preserves failed backfill history across refreshes.
- Residual risk: Same-origin XSS could forge this availability-only refresh request, causing bounded bootstrap churn but not credential disclosure; the request carries no secret and cannot target a non-embedded child session.
- Validation (test/review/path): `client/src/components/common/embeddedManagerBootstrap.ts`; `client/src/components/common/embeddedManagerBootstrap.test.ts`; `client/src/hooks/useEmbeddedManagerPasscodeExchange.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`.
- Follow-up action: If repeated refresh requests become an operational concern, add a parent-side rate limit keyed by child session without weakening token rotation.
- Owner: Codex

- Date: 2026-07-13
- Area: Postboard instructor bootstrap
- Threat or risk: Postboard's activity configuration previously declared `instructorPasscode` sessionStorage bootstrap, leaving a reusable manager credential accessible to same-origin JavaScript.
- Control or mitigation: Postboard now accepts the immediate router-state bootstrap or SyncDeck's short-lived server-issued manager-token exchange only; its manager no longer reads instructor credentials from Web Storage.
- Residual risk: A temporary standalone manager still needs an authenticated server-backed recovery flow to survive a full reload; do not restore browser-storage fallback to address that gap.
- Validation (test/review/path): `activities/postboard/activity.config.ts`; `activities/postboard/client/manager/PostboardManager.tsx`; `activities/postboard/client/manager/PostboardManager.test.ts`.
- Follow-up action: Add cookie- or token-backed recovery if temporary standalone Postboard reload recovery becomes a product requirement.
- Owner: Codex

- Date: 2026-07-13
- Area: SyncDeck temporary instructor recovery
- Threat or risk: The generated SyncDeck instructor passcode was held only in router state for temporary sessions, so a browser reload lost authority; persisting that passcode in browser storage is prohibited.
- Control or mitigation: `POST /api/syncdeck/create` now mints a random session-scoped recovery token, stores it only on the server session record, and appends it to one capped httpOnly, same-site, secure-in-production browser-session cookie scoped to the SyncDeck API prefix. The cookie retains at most 20 recent entries; each token is honored only by its matching session's instructor-passcode recovery route. The route uses a timing-safe comparison and returns the passcode only when that cookie token matches; server-side session validity and its sliding TTL remain authoritative.
- Residual risk: The cookie authorizes instructor recovery for active sessions in the issuing browser profile until the browser session ends or the server session expires; do not widen its path or make it readable by JavaScript.
- Validation (test/review/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`.
- Follow-up action: If multi-device temporary-session recovery is required, add an explicit instructor-authentication flow instead of sharing this browser-bound recovery credential.
- Owner: Codex

- Date: 2026-06-24
- Area: dependency update audit
- Threat or risk: Dependabot PR `#279` identified current npm security updates for `undici`, `http-proxy-middleware`, `vite`, and `esbuild`; additional direct dependency patch/minor releases were also available.
- Control or mitigation: Refreshed root and standalone workspace npm locks; updated `undici` to `7.28.0`, `http-proxy-middleware` to `^4.1.1`, updated `esbuild` to `0.28.1`, and moved current direct ranges for Vite, React Router, TypeScript ESLint, JSDoc ESLint plugin, globals, React plugin, React refresh plugin, and Brython. Kept `@types/node` on the Node 24 line because the repo engine is `>=24 <25`. 
- Residual risk: `npm outdated --workspaces --include-workspace-root` still reports `@types/node` 26.x as latest, but this is intentionally held until the runtime engine moves beyond Node 24.
- Validation (test/review/path): `package.json`; `package-lock.json`; `client/package.json`; `client/package-lock.json`; `server/package.json`; `server/package-lock.json`; `activities/package.json`; `activities/package-lock.json`; root and standalone workspace audits; `npm run test:codex`; `npm run verify:deploy`; `npm run verify:node-version-sync`; `npm run verify:playwright-version-sync`; `npm run verify:activity-test-groups`; `npm run verify:server`.
- Follow-up action: Revisit `@types/node` only with a coordinated runtime engine update.
- Owner: Codex

- Date: 2026-07-12
- Area: SyncDeck embedded instructor manager bootstrap
- Threat or risk: Embedded manager iframes run in a separate JavaScript context, so an in-memory parent handoff cannot deliver an instructor passcode. Persisting that passcode to browser storage is prohibited.
- Control or mitigation: SyncDeck mints a random, five-minute child-manager entry token server-side, passes it only to the same-origin iframe, and the child exchanges it once through a SyncDeck endpoint. There are now two exchange contracts, both consuming the same one-time token the same way: the legacy `GET /api/syncdeck/embedded-manager-passcode` returns the child session's instructor passcode (captured before the atomic consume; the route does not re-read or re-persist the child afterward), and the newer `GET /api/syncdeck/embedded-manager-capability` — available to any embedded child that holds a valid entry token, including credentialless children that have no passcode — atomically consumes the token, re-reads the child session, and issues an httpOnly manager capability cookie named `activebits_cap_manager_<base64url(childSessionId)>` (the scope segment is `getActivityCapabilityCookieName`'s base64url encoding of the child session id, not the raw id), returning a controlled 500 without a cookie if that persist fails. Endpoint support is not the same as client adoption: as of this note only Video Sync's embedded manager redeems the capability token (via `useEmbeddedManagerCapabilityExchange`); other embedded managers, including credentialless children such as Raffle, still ignore the token (`buildEmbeddedManagerBootstrapPayload` in `activities/syncdeck/server/routes.ts`) and their manager stays a public principal until migrated. Do not assume Raffle's embedded manager is capability-authenticated. Token consumption is atomic in both in-memory and Valkey-backed session stores, checks expiry at consumption time, rejects any present missing/non-numeric/non-finite/expired expiry value, and refreshes the consumed session's normal TTL, so concurrent, malformed, or expired redemptions cannot succeed. The exchange response and browser request both opt out of caching, and the iframe uses `strict-origin-when-cross-origin`, so any cross-origin request it makes sends only the app origin as its `Referer` and never the one-time token in the URL's query string; after an exchange attempt, the child replaces its URL to remove the attempted query token even when recovery is needed. The iframe is not mounted until the token arrives from the authenticated embedded-start response.
- Residual risk: The short-lived token is present in the iframe URL while it loads. Keep it same-origin, do not log query strings, and do not reuse it as an activity API credential. Child managers yield once before exchanging it so React StrictMode's development-only setup/cleanup pass cannot consume it before the durable mount commits.
- Operational constraint: Because the token is consumed after exchange, SyncDeck clears a child token when its manager iframe is evicted from the warm-mount limit and reuses the authenticated embedded-start backfill path to obtain a fresh token before a later remount.
- Validation (test/review/path): `server/core/sessions.ts`; `server/core/sessionTokenUtils.ts`; `server/core/sessionTokenUtils.test.ts`; `server/core/valkeyStore.ts`; `server/core/valkeyStore.test.ts`; `server/sessionTokenConsumption.test.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `client/src/components/common/embeddedManagerBootstrap.ts`; `client/src/components/common/embeddedManagerBootstrap.test.ts`; `client/src/hooks/useEmbeddedManagerPasscodeExchange.ts`; `client/src/hooks/useEmbeddedManagerPasscodeExchange.test.ts`; `activities/syncdeck/playwright/embedded-manager-bootstrap.spec.ts`.
- Follow-up action: If iframe URL query logging becomes a concern, replace the query handoff with an httpOnly one-time exchange cookie scoped to the child manager route.
- Owner: Codex

- Date: 2026-06-13
- Area: dependency update audit
- Threat or risk: Dependabot flagged the transitive `esbuild` version, and stale workspace lockfiles can keep vulnerable transitive packages even when the root lock is already refreshed.
- Control or mitigation: Refreshed root and standalone workspace npm locks; `server/package-lock.json` now resolves `tsx` through `esbuild@0.28.1`, and direct dependency ranges were bumped for `@tailwindcss/vite`, `tailwindcss`, `brython`, and `eslint`. Kept `@types/node` on the Node 24 line because the repo engine is `>=24 <25`.
- Residual risk: `npm outdated --workspaces --include-workspace-root` still reports `@types/node` 25.x as latest, but this is intentionally held on 24.x until the repo's Node engine moves beyond `>=24 <25`.
- Validation (test/review/path): `package-lock.json`; `client/package-lock.json`; `server/package-lock.json`; `activities/package-lock.json`; `client/package.json`; `server/package.json`; `activities/package.json`; `npm audit --include=dev --workspaces --include-workspace-root`; standalone workspace audits; `npm run test:codex`; `npm run verify:deploy`; `npm run verify:server`.
- Follow-up action: Revisit `@types/node` only with a coordinated runtime engine update.
- Owner: Codex

- Date: 2026-06-11
- Area: dependency update audit
- Threat or risk: Dependency updates can leave stale vulnerable transitive packages or accidentally move type/runtime assumptions ahead of the deployed Node major.
- Control or mitigation: Refreshed root and workspace npm locks after point and selected major updates; `npm install --package-lock-only --include=dev --workspaces --include-workspace-root` and each workspace lock refresh reported `found 0 vulnerabilities`. Kept `@types/node` on the Node 24 line because the repo engine is `>=24 <25`, even though the registry also has Node 25 types.
- Residual risk: Port-dependent server tests self-skip only when sandbox policy denies the initial local bind (`EPERM` or `EACCES`); periodically run the full suite with port binding enabled so those endpoint and WebSocket paths execute.
- Validation (test/review/path): `package.json`; `client/package.json`; `server/package.json`; `activities/package.json`; `package-lock.json`; `npm run test:codex`.
- Follow-up action: Revisit `@types/node` only with a coordinated runtime engine update.
- Owner: Codex

- Date: 2026-06-06
- Area: MobCode Brython vendor assets
- Threat or risk: The Python runner needs same-origin Brython JavaScript files, and file-serving routes without rate limiting can be abused for repeated filesystem-backed reads.
- Control or mitigation: `/vendor/brython/:assetName` uses `express-rate-limit` before serving an allowlist of Brython assets (`brython.min.js`, `brython.js`, `brython_stdlib.js`) resolved from the server-owned npm package. Requests outside the allowlist return 404 directly, and production Express instances trust one proxy hop so Render-forwarded client IPs feed IP-based limits.
- Residual risk: The route still serves public static runtime code and depends on the server workspace installing the `brython` package.
- Validation (test/review/path): `server/server.ts`; `npm --workspace server run lint`; `npm --workspace server run typecheck`.
- Follow-up action: If more vendor assets are exposed later, keep them behind explicit allowlists and shared rate-limited middleware instead of broad package-directory static routes.
- Owner: Codex

- Date: 2026-06-04
- Area: mobcode zip/file import
- Threat or risk: Client-side zip/file imports that allocate full file buffers before enforcing size caps can freeze the tab or exhaust memory with oversized plain files or highly compressed zip entries.
- Control or mitigation: MobCode now rejects oversized plain files by `File.size` before `arrayBuffer()` and uses JSZip central-directory `uncompressedSize` metadata to skip oversized zip entries before inflating them.
- Residual risk: The import path still trusts JSZip metadata enough to decide whether to inflate an entry; malformed archives can still cost zip-parse work up to the outer archive-size cap, but no longer inflate obviously oversized entries.
- Validation (test/review/path): `activities/mobcode/client/utils/zipUtils.ts`; `activities/mobcode/client/utils/zipUtils.test.ts`.
- Follow-up action: If we ever need stronger zip-bomb resistance than JSZip metadata plus archive-size caps, move archive extraction into a streaming worker or server-side preprocessing path.
- Owner: Codex

- Date: 2026-06-02
- Area: resonance Markdown rendering
- Threat or risk: Authored Markdown for question stems and MCQ choices can carry raw HTML or unsafe URLs that would create XSS, navigation, or local-file exposure risks if rendered directly.
- Control or mitigation: Resonance renders Markdown through `react-markdown` with raw HTML skipped, GFM enabled, and activity-owned URL filtering. Links allow safe web/mail schemes and open with `rel="noopener noreferrer"`. Images allow `http:`, `https:`, and non-SVG image MIME `data:` URLs only; `javascript:`, `file:`, and SVG data URLs are blocked.
- Residual risk: Remote and data images can still display instructor-authored external content and may affect payload size, so validation keeps finite caps and classroom authors remain responsible for image provenance.
- Validation (test/review/path): `activities/resonance/client/components/FormattedMarkdown.tsx`; `activities/resonance/client/components/FormattedMarkdown.test.tsx`; `activities/resonance/shared/validation.test.ts`
- Follow-up action: If SVG image support becomes required, add a sanitizer-specific design and tests before allowing SVG data URLs.
- Owner: Codex

- Date: 2026-03-22
- Area: Playwright production-mode test secret handling
- Threat or risk: Committing a fixed `PERSISTENT_SESSION_SECRET` in the Playwright harness creates secret-scanner noise and normalizes checking pseudo-secrets into the repo, even when the value is test-only.
- Control or mitigation: `playwright.config.ts` now generates a random 32-byte hex secret at config-load time and passes it through `webServer.env`; CI or other deterministic environments can override it with `PLAYWRIGHT_PERSISTENT_SESSION_SECRET`.
- Residual risk: A caller that reuses the same override value across many runs still has a long-lived test secret by choice, but it is no longer embedded in version control.
- Validation (test/review/path): `playwright.config.ts`; `npm run test:e2e -- --list`.
- Follow-up action: Reuse the same runtime-generation pattern for any other local test harness secret that only exists to satisfy production-mode startup checks.
- Owner: Codex

- Date: 2026-03-21
- Area: resonance persistent-link question payload decryption
- Threat or risk: Authenticated but attacker-controlled compressed payloads can trigger very large inflation output (zip-bomb style), causing high memory pressure during `inflateSync` before JSON parsing.
- Control or mitigation: `decryptQuestions` now enforces a hard inflate output ceiling via `inflateSync(..., { maxOutputLength })` and returns `null` when decompression exceeds the cap.
- Residual risk: The cap constrains worst-case inflate memory, but decryption/inflate CPU cost for malformed high-entropy inputs is still non-zero; rate limiting remains a broader transport-layer concern.
- Validation (test/review/path): `activities/resonance/server/questionCrypto.ts`; `activities/resonance/server/questionCrypto.test.ts`.
- Follow-up action: If payload complexity grows (for example image support), re-evaluate the output cap and consider streaming decompression for stricter incremental control.
- Owner: Codex

- Date: 2026-03-14
- Area: devcontainer privilege model
- Threat or risk: Granting `SYS_ADMIN` and disabling AppArmor/seccomp in the default devcontainer materially increases local container privilege and can surprise contributors or CI-like environments that expect the repo's base dev setup to stay constrained.
- Control or mitigation: The default devcontainer stays least-privilege, and the elevated settings now live in a separate opt-in profile at `.devcontainer/privileged/devcontainer.json` via `.devcontainer/docker-compose.privileged.yml`.
- Residual risk: Contributors who choose the privileged profile still accept a wider local attack surface and weaker isolation for that container.
- Validation (test/review/path): `.devcontainer/docker-compose.yml`; `.devcontainer/docker-compose.privileged.yml`; `.devcontainer/privileged/devcontainer.json`; `README.md`
- Follow-up action: Keep any future privileged devcontainer changes opt-in, and document the specific local tool class that requires them instead of broadening the default container.
- Owner: Codex

- Date: 2026-03-04
- Area: syncdeck instructor websocket authentication
- Threat or risk: `syncdeck` previously put `instructorPasscode` in the instructor websocket query string, which exposes the credential to URL logging in proxies, access logs, and observability tooling.
- Control or mitigation: The instructor client now connects to `/ws/syncdeck` with only `sessionId` and `role=instructor`, then sends a one-shot websocket `authenticate` message with the passcode after the socket opens; the server waits for that auth message before marking the socket as an instructor or replaying instructor-only state.
- Residual risk: The passcode still exists in live client memory and in websocket frame payloads. If stronger protection is needed, move to an httpOnly cookie or short-lived server-issued websocket token.
- Validation (test/review/path): `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`.
- Follow-up action: Keep `syncdeck` aligned with `video-sync` if either websocket auth flow is hardened further, so manager activities do not diverge back to query-string secrets.
- Owner: Codex

- Date: 2026-03-04
- Area: video-sync manager websocket authentication
- Threat or risk: Putting `instructorPasscode` in the manager websocket query string exposes a session credential to request URL logging in proxies, access logs, and observability tooling even though it never appears in the browser address bar.
- Control or mitigation: The manager client now connects to `/ws/video-sync` with only `sessionId` and `role=manager`, then sends a one-shot websocket `authenticate` message containing the passcode after the socket opens; the server ignores URL-based manager passcodes and verifies the post-connect auth message before subscribing the socket or sending manager state.
- Residual risk: The passcode still exists in live client memory and travels in websocket message payloads, so raw websocket frame capture at the edge would still reveal it. If stronger protection is needed later, prefer an httpOnly cookie or short-lived server-issued websocket token over long-lived shared secrets.
- Validation (test/review/path): `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`.
- Follow-up action: If other manager-only websocket activities use query-string secrets, move them to the same post-connect auth or cookie-backed pattern.
- Owner: Codex

- Date: 2026-03-04
- Area: video-sync manager bootstrap
- Observation: Temporary `video-sync` sessions now recover the create-session `instructorPasscode` from a same-tab in-memory bootstrap map when router navigation state is unavailable. The payload is consumed once and never written to Web Storage for this fallback path.
- Why it matters: This restores ad hoc teacher startup without reintroducing the broader XSS exposure of persisting the passcode in `sessionStorage` across the tab lifetime.
- Evidence: `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/video-sync/client/manager/VideoSyncManager.tsx`
- Follow-up action: If cross-reload recovery is needed for non-persistent sessions, add an explicit server-issued recovery mechanism rather than expanding Web Storage use.
- Owner: Codex

- Date: 2026-03-04
- Area: video-sync manager credential bootstrap
- Threat or risk: Persisting the manager `instructorPasscode` in `sessionStorage` leaves a 32-byte session credential available to any same-origin JavaScript, so an XSS bug could recover and replay it long after the initial create redirect.
- Control or mitigation: `video-sync` now treats the create-session passcode as a one-time router-state bootstrap consumed on first manager mount and immediately removed from navigation state; subsequent recovery uses the teacher-cookie-authenticated `/api/video-sync/:sessionId/instructor-passcode` endpoint instead of browser storage.
- Residual risk: The passcode remains present in live React state while the manager page is open and still travels in manager-authenticated requests/WebSocket URLs. Temporary non-persistent sessions also no longer survive a full-page reload with manager credentials intact unless another authenticated recovery path is added.
- Validation (test/review/path): `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/video-sync/activity.config.ts`.
- Follow-up action: If preserving manager control across full reloads for temporary sessions becomes a requirement, prefer an httpOnly server-issued recovery cookie or short-lived recovery token over reintroducing Web Storage.
- Owner: Codex

- Date: 2026-07-11
- Area: syncdeck static-presentation instructor launch
- Threat or risk: Storing the generated SyncDeck `instructorPasscode` in `sessionStorage` for `/util/syncdeck/launch-presentation?mode=instructor` triggers CodeQL clear-text sensitive-storage alerts and exposes the temporary manager credential to any same-origin JavaScript for the life of the tab.
- Control or mitigation: Immediate instructor launches now pass the generated passcode to `/manage/syncdeck/:sessionId` through same-tab React Router state. The SyncDeck manager reads that one-shot router state before falling back to cookie-backed recovery, so the presentation launch path does not write the passcode to Web Storage.
- Residual risk: The passcode still exists in live React state while the manager page is open and travels in manager-authenticated requests/websocket auth messages. A full-page reload of this temporary launch path may lose manager credentials unless an authenticated recovery path exists.
- Validation (test/review/path): `activities/syncdeck/client/util/SyncDeckLaunchPresentation.tsx`; `activities/syncdeck/client/util/SyncDeckLaunchPresentation.test.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`.
- Follow-up action: If reload-stable manager recovery is needed for presentation-launched temporary sessions, prefer an httpOnly server-issued recovery cookie or short-lived recovery token over Web Storage.
- Owner: Codex

- Date: 2026-03-03
- Area: video-sync persistent teacher-cookie parsing
- Threat or risk: The `persistent_sessions` cookie is client-controlled input, so logging JSON parse failures at error level lets attackers generate noisy server log spam without affecting authorization.
- Control or mitigation: `activities/video-sync/server/routes.ts` now treats malformed `persistent_sessions` JSON as an ordinary invalid cookie and returns `[]` without calling `console.error`; instructor-passcode recovery still returns the same `403` path when no valid teacher entry is present.
- Residual risk: Malformed cookies are now silent, so malformed-input observability would need an explicit debug/rate-limited logger if incident analysis later requires it.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`.
- Follow-up action: If other activities add persistent-cookie recovery helpers, keep malformed-cookie handling non-erroring unless there is a rate-limited structured logging path available.
- Owner: Codex

- Date: 2026-03-03
- Area: video-sync telemetry normalization
- Threat or risk: Session records created before current clamp logic (or modified externally) can carry oversized `telemetry.error.code/message` strings that are rebroadcast to all websocket clients and returned by session APIs.
- Control or mitigation: `normalizeTelemetry` now sanitizes persisted `telemetry.error` using `normalizeTelemetryErrorField` with `MAX_TELEMETRY_ERROR_CODE_LENGTH` and `MAX_TELEMETRY_ERROR_MESSAGE_LENGTH`, matching event-ingestion caps.
- Residual risk: Oversized values are now truncated, not rejected; if strict rejection is required for forensics, add explicit invalid-record signaling.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `npm run test:activities:scope -- --target=video-sync`.
- Follow-up action: Keep any new telemetry string fields wired through normalization helpers to avoid reintroducing persisted unbounded payloads.
- Owner: Codex

- Date: 2026-03-03
- Area: activities/video-sync command + config responses
- Threat or risk: Returning full session `data` in routine success responses can leak `instructorPasscode` into browser logs, monitoring payload captures, or downstream persistence layers that ingest API responses.
- Control or mitigation: `PATCH /api/video-sync/:sessionId/session` and `POST /api/video-sync/:sessionId/command` now return only public fields via `toPublicSessionData(data)` (`state`, `telemetry`).
- Residual risk: The passcode is still intentionally returned by create/recovery endpoints and sent by manager command/config requests; avoid logging request bodies and keep passcode handling scoped.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `npm run test:activities:scope -- --target=video-sync`.
- Follow-up action: If additional video-sync endpoints add success payloads, reuse `toPublicSessionData` to keep response surfaces consistent and secret-free.
- Owner: Codex

- Date: 2026-03-01
- Area: video-sync student telemetry event ingestion
- Threat or risk: `POST /api/video-sync/:sessionId/event` is intentionally student-writable for telemetry, so accepting arbitrary `errorCode` and `errorMessage` on every event let callers overwrite manager-visible error state and persist unbounded strings into the session.
- Control or mitigation: Only `load-failure` events may update `telemetry.error`, and both `errorCode` and `errorMessage` are trimmed and capped before persistence/broadcast (`64` and `256` chars respectively).
- Residual risk: Students can still emit repeated `load-failure` events for a real session and replace the latest error within those bounds. Unsync telemetry is also student-writable, but the per-session unsynced-student map is now capped to bound memory growth; if noise becomes a problem, add rate limiting or stronger per-student identity on top.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `npm --workspace activities run test:activity --activity=video-sync`.
- Follow-up action: If the manager UI needs richer diagnostics, define an explicit allowlist of load-failure error codes rather than treating the code field as arbitrary text, and consider rate limiting repeated unsync events per session.
- Owner: Codex

- Date: 2026-02-23
- Area: persistent link deep-link parameters
- Threat or risk: Generic persistent-link deep-link options are appended as query params and are not integrity-protected by the existing `/api/persistent-session/create` flow. A teacher-facing URL parameter such as `presentationUrl` can be modified by URL tampering if an activity trusts it directly.
- Control or mitigation: Use an activity-specific URL generator endpoint for sensitive deep-link options (SyncDeck: `POST /api/syncdeck/generate-url`) that validates option values and emits signed integrity metadata (`urlHash`) bound to persistent hash + option payload. Treat generated URL as authoritative and verify signature before applying sensitive options.
- Residual risk: If activity code bypasses signature verification during session configuration, tampered links may still be accepted. Verification must remain server-side and mandatory on sensitive configuration paths.
- Validation (test/review/path): `.agent/plans/syncdeck.md` (Architecture + Checklist); `server/routes/persistentSessionRoutes.ts` (current unsigned generic flow); planned tests in `activities/syncdeck/server/routes.test.ts`.
- Follow-up action: Implement verification in SyncDeck configure path and add explicit tampered-`urlHash` test coverage.
- Owner: Codex

- Date: 2026-02-23
- Area: deep-link input validation (client + server)
- Threat or risk: Without field-level validation, malformed or unsafe presentation links can be entered in modals and later submitted through alternative paths.
- Control or mitigation: Added declarative `validator: 'url'` support in activity deep-link options; ManageDashboard now shows inline errors and disables create/copy/open actions for invalid URL inputs; SyncDeck server configure route independently validates `presentationUrl` as `http(s)`.
- Residual risk: URL syntax validation does not enforce destination trust (for example host allowlists). Instructors can still provide any public `http(s)` URL.
- Validation (test/review/path): `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/server/routes.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `activities/syncdeck/server/routes.test.ts`; `npm test`.
- Follow-up action: Add optional hostname/domain allowlist policy if deployment requires restricting presentation origins.
- Owner: Codex

# MobCode live student-code boundary

- Resolve a MobCode student workspace from the accepted waiting-room participant record, not from a display name or a client-selected workspace identifier. Manager-only settings still require the MobCode instructor passcode.
- Expected denied student edits (missing accepted identity or Try it disabled) use structured MobCode event logs without source contents.
- The generic entry-participant consume route now issues an opaque httpOnly token scoped to the accepted session. MobCode reads this token server-side and never accepts a participant ID in its student workspace API bodies.
- SyncDeck embedded child sessions receive that one-time entry token asynchronously over the parent websocket, so MobCode waits briefly for the token and retries a denied child-workspace bootstrap once. The retry still redeems the opaque token through the generic consume route; it must not reintroduce a browser-supplied participant ID.

# Video Sync manager capability cutover

- Area: Video Sync manager authorization
- Threat or risk: A reusable `instructorPasscode` in session data and manager request/WebSocket contracts could be returned to browser JavaScript or replayed by any holder.
- Control or mitigation: Video Sync now issues only an httpOnly manager capability at creation and verified persistent/embedded recovery. Manager REST and WebSocket admission require that capability; session normalization removes any legacy `instructorPasscode` field.
- Residual risk: Existing in-flight sessions created before deployment may lose manager access after the field removal; this is an accepted clean-cutover boundary.
- Validation (test/review/path): `activities/video-sync/server/routes.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `activities/video-sync/playwright/auth.spec.ts`.
- Follow-up action: Do not add raw manager secrets to a new activity contract; use the shared capability adapter.
- Owner: Codex

# Shared socket paths with multiple authenticated principals

- A browser can hold both a manager capability cookie and a participant cookie for one session. A shared activity WebSocket path must have the client select its intended view (`manager` or `participant`), but the server must resolve and require the corresponding httpOnly capability before assigning that principal. The selector is routing only; it must never grant authority. This keeps an instructor's student tab from being misclassified as a manager and omitted from the roster.

# Video Sync session mutation ordering

- Video Sync serializes each local session's read-modify-write operations, including manager commands, student telemetry, heartbeats, socket connection telemetry, and stale-telemetry pruning. This prevents a background operation that read an old state from later persisting over a play, pause, or seek command.
- The queue is deliberately scoped to one server process. Multi-instance atomic session updates remain tracked separately because a process-local queue cannot serialize writers on different application instances.

# Persistent manager capability recovery

- A persistent teacher-cookie authentication proves the teacher's authority but does not itself populate an activity manager capability. Manager clients with capability-gated routes must redeem that verified cookie through the server-side persistent-manager-capability recovery endpoint before opening their manager socket or protected REST calls.
