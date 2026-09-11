# Data Contracts

## MobCode live-session defaults

- Date: 2026-08-19
- Area: activities | mobcode | session normalization
- Contract: Newly initialized MobCode live sessions set `studentCode.shareChangesEnabled` to `true` unless `embeddedLaunch.selectedOptions.startTryItMode === true`. Once `studentCode` exists, persisted instructor flags remain authoritative.
- Why it matters: Standalone and embedded sessions should immediately mirror instructor edits by default without overwriting later instructor toggle choices during normalization or reload.
- Evidence: `activities/mobcode/server/routes.ts`; `activities/mobcode/server/routes.test.ts`; `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`
- Owner: Codex

Document API and data-shape assumptions that must stay compatible over time.

> **Atomic-session errata (2026-09-04):** In the 2026-09-02 Video Sync atomic
> session-mutation entry, the later “CAS compatibility”, “Cache ordering”, and
> “Cache fill ownership” clarifications are authoritative. They supersede its
> earlier wording that a missing stored `created` uses revision-only matching or
> that an equal revision can supersede a raced cache fill.

## Shared Runtime Contract Pointer

The version 1 activity runtime principal, capability, projection, HTTP-admission, and
WebSocket-delivery contract is documented in
`.agent/knowledge/activity-runtime-threat-model.md`. New shared runtime work must use
that document rather than creating activity-specific authentication payloads.

## Entry Template

- Date:
- Surface: REST | websocket | internal module | activity interface
- Contract:
- Compatibility constraints:
- Validation rules:
- Evidence (schema/tests/path):
- Follow-up action:
- Owner:

## Contracts

- Date: 2026-09-01
- Surface: websocket | REST | activity interface (video-sync)
- Contract: Video Sync clients (manager and student) apply an incoming `state-update` / `state-snapshot` / `heartbeat` frame only when `shouldApplyIncomingVideoSyncState(current, next)` allows it: reject `next` when `next.serverTimestampMs < current.serverTimestampMs`; on an equal `serverTimestampMs` reject a non-instructor frame when `current.updatedBy === 'instructor'`; always apply while `current.videoId === ''`. A configured -> different-`videoId` frame is **not** exempt from the timestamp check - the server rejects re-configuration with 409 `CONFIG_LOCKED`, so an older-timestamp different-id frame is only ever a stale frame for the previous video and is rejected the same as any other stale frame; a genuine reconfigure carries a newer `serverTimestampMs` and passes the normal ordering check. The manager still also rejects a configured -> empty transition (`shouldApplyManagerStateUpdate`).
- Compatibility constraints: **Updated 2026-09-02 (PR #365):** `shouldApplyIncomingVideoSyncState` now orders by `playbackRevision` **first** (reject a strictly lower revision) and only falls back to `serverTimestampMs` within one revision — see the 2026-09-02 "Video Sync REST | websocket | multi-instructor playback" entry below, which is authoritative for ordering. The storage-level compare-and-set primitive it called "deferred" **shipped** in that commit (`SessionStore.updateAtomic` / `compareAndSet`), and every write in the `video-sync` route module now goes through it rather than the strict-read + `isDeepStrictEqual` gate this bullet originally described (the shared `entry-participant` / `consume` platform routes are the documented exception — see the 2026-09-02 store-contract entry below and #313). `normalizeState` still backfills a finite `serverTimestampMs`.
- Validation rules: A late `isPlaying:true` frame after an instructor pause is dropped, not applied. Command HTTP responses are routed through the same manager guard as websocket frames. Both `VideoSyncManager` and `VideoSyncStudent` are reused across a parameter-only route swap, so each has a `[sessionId]` effect that resets its applied `state` (and the manager's `latestStateRef`) to `DEFAULT_STATE` before the new session loads - otherwise `shouldApplyIncomingVideoSyncState` / `reduceVideoSyncStudentIncomingState` would compare session B's snapshot against session A's retained state and reject every B frame whose `serverTimestampMs` is older.
- Evidence (schema/tests/path): `activities/video-sync/client/syncMath.ts`; `activities/video-sync/client/syncMath.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/student/VideoSyncStudent.test.ts`
- Follow-up action: `playbackRevision` is now that dedicated monotonic ordering field (shipped 2026-09-02, PR #365). Keep the manager and student guards aligned whenever the revision-ordering rule changes: both `shouldApplyIncomingVideoSyncState` call sites, `reduceVideoSyncStudentIncomingState`, and the server-side `playbackRevision + 1` bump sites (`/command`, config PATCH, heartbeat stop-transition, GET `/session` persist, WS snapshot) must agree on which frame wins.
- Owner: Claude

- Date: 2026-09-01
- Surface: activity interface (video-sync manager)
- Status: **SUPERSEDED 2026-09-02 (PR #365, commit 58eed143)** — see the 2026-09-02 "Video Sync REST | websocket | multi-instructor playback" entry below.
- Contract (historical): The manager originally mirrored its own YouTube `onStateChange` transitions to the server as commands, gated by a programmatic-echo suppression window (`resolveManagerStateChangeIntent` / `programmaticPlaybackTargetRef`) and a genuine-user-activation recency check (`isManagerPlaybackGestureRecent` / `readManagerUserActivation` / `MANAGER_USER_GESTURE_GRACE_MS` / `lastUserActivationAtRef` / `shouldMirrorManagerPlaybackTransition`). That entire mechanism was removed: the iframe now renders `controls: 0` / `pointer-events-none` / `aria-hidden` and is a pure projection, and playback authority moved to activity-owned Play/Pause/Seek controls that issue `POST /command` with a `commandId` + `managerId`. The only surviving `onStateChange` path is a natural `ENDED`, which sends a `pause` with `source: 'natural-ended'` + `expectedPlaybackRevision` that the server accepts only from the manager owning the current `playbackRevision`. `resolveManagerStateChangeIntent`, `isManagerPlaybackGestureRecent`, `shouldMirrorManagerPlaybackTransition`, `readManagerUserActivation`, `consumeProgrammaticPlaybackTarget`, `programmaticPlaybackTargetRef`, `lastUserActivationAtRef`, and the suppression-window helpers no longer exist. `retryManagerAutoplay` still re-applies authoritative state through `applyStateToPlayer` rather than a bare `playVideo()`.
- Owner: Claude

- Date: 2026-09-01
- Surface: activity interface (video-sync manager)
- Contract: `VideoSyncManager` is route-param keyed and can be reused (not remounted) across a parameter-only session swap. A `[sessionId]` effect resets `latestStateRef`, `state`, `telemetry`, `setupMode`, `sourceUrlInput`, and `errorMessage` to their session-empty defaults, and clears the queued-playback refs (`desiredPlaybackIntentRef`, `desiredPlaybackPositionRef`, `playbackFlushRetryCountRef`, `playbackCommandInFlightRef`, and the `playbackCommandFlushTimerRef` timeout) directly - not via the deferred `setupMode` player-teardown cascade, which lands a render later - so a 120 ms flush timer that fires after navigation cannot POST session A's intent/position to session B. This runs before the new session's snapshot/websocket frames arrive, so the freshness guard (`shouldApplyIncomingVideoSyncState`) compares the new session's `serverTimestampMs` against its own baseline and the setup form never shows or Saves the previous session's URL/stop time (`stopSecInput`/`hasStopTime` follow `state.stopSec` via their own effect). The bootstrap auto-configure IIFE also re-checks `sessionIdRef` before `setAutoStartStatus`, so a stale config PATCH returning `false` after a swap doesn't stamp the new session's auto-start as `failed`. Every state-producing async response is bound to the session it was issued for: `fetchSession` is passed the session-fetch effect's `AbortController` signal, and `sendCommand` / `saveConfigWithValues` check `sessionIdRef.current !== sessionId` after **every** `await` - after the `fetch`, after the failure-body parse (before `revalidateManagerAccess` / the error banner), after the success-body parse, and as the first line of the `catch`. None of them can call `applyManagerStateUpdate`, `setErrorMessage`, or `revalidateManagerAccess` for a previous session after the `[sessionId]` baseline reset (which would either restore the old session into the new view — the empty baseline accepts any frame — or leave the new session's legitimately older snapshot failing the freshness guard). The websocket path is already covered by the `envelope.sessionId !== sessionId` filter plus reconnect-on-`sessionId`-change. Separately, all self-rescheduling playback flushes go through `flushManagerPlaybackIntentRef` (kept pointed at the latest `flushManagerPlaybackIntent` by an effect), so a retry timer armed while `hasManagerAccess` was momentarily `false` during a `revalidateManagerAccess()` cycle re-runs the current callback (which sees access restored) rather than a stale closure bound to `hasManagerAccess === false`. This also makes `scheduleManagerPlaybackIntentFlush` referentially stable (its only dependency is a `[]`-stable callback), so the player-lifecycle effect can depend on it directly without the access-cookie refresh churn tearing down and rebuilding the YouTube player (which would also wipe an in-flight retry).
- Compatibility constraints: Any timer or effect that re-invokes a playback-command callback derived from `sendCommand`/`hasManagerAccess` must read it through `flushManagerPlaybackIntentRef` (or an equivalent latest-ref), not close over the render-time callback, so a `revalidateManagerAccess()` cycle cannot strand it on a stale `hasManagerAccess === false` closure. Keep `scheduleManagerPlaybackIntentFlush` free of `sendCommand`/`flushManagerPlaybackIntent` dependencies so it stays referentially stable for the player-lifecycle effect. Any new manager fetch whose response mutates React state must add the same `sessionIdRef` post-`await` checks (or an `AbortController`), including in its `catch`.
- Validation rules: A pending retry timer (`playbackCommandFlushTimerRef`) and `desiredPlaybackIntentRef` must survive a `hasManagerAccess` flap; only an explicit `setupMode` transition or `sessionId` change may destroy the player instance. Each `flushManagerPlaybackIntent` send claims a monotonic token (`playbackFlushTokenSeqRef` -> `playbackFlushOwnerRef`); the `[sessionId]` reset and every player teardown set the owner back to `0`. On resolving, a send that no longer owns the token (a session swap or a superseding flush moved ownership) returns without touching `playbackCommandInFlightRef` or the intent refs. When it still owns the token, it additionally compares the sent intent+position against the current refs and, if a newer same-session gesture changed them, schedules a follow-up flush instead of clearing them.
- Evidence (schema/tests/path): `activities/video-sync/client/manager/VideoSyncManager.tsx`
- Follow-up action: none.
- Owner: Claude

- Date: 2026-08-27
- Surface: REST | websocket | Resonance student session snapshot
- Contract: Resonance student snapshots retain the viewer's most recent answer for a question across active-run changes so revisiting or reactivating that question pre-fills editable work. Earlier answers do not block a new draft or submission.
- Compatibility constraints: Historical responses remain in the instructor snapshot and retain their response IDs so a revised submission can upsert the existing response record. Student snapshots for inactive/self-paced questions retain the existing answer behavior.
- Validation rules: Student clients reject any older run/session snapshot, including when the active question changes or after an idle snapshot, but reset snapshot ordering state when either the session ID or student ID changes. Transitioning from idle/self-paced mode into a live run is a new run even when its question IDs are unchanged, so retained local answers for those questions must be cleared before the next render can hydrate a question. A same-run snapshot may refresh an unchanged draft, but must not overwrite locally edited work. Student answer and draft messages are bound to the connected socket's student ID; a payload cannot select another student record.
- Evidence (schema/tests/path): `activities/resonance/server/routes.ts`; `activities/resonance/server/routes.test.ts`; `activities/resonance/client/hooks/useResonanceSession.ts`; `activities/resonance/client/hooks/useResonanceSession.test.ts`; `activities/resonance/client/student/QuestionView.tsx`; `activities/resonance/client/student/QuestionInputs.test.tsx`.
- Follow-up action: Any future Resonance transport carrying session state should preserve this run-ordering rule or introduce a monotonic server revision for stronger ordering across all state changes.
- Owner: Codex

- Date: 2026-08-05
- Surface: REST | MobCode manager session snapshot
- Contract: The named student workspace roster is ordered with the fixed `en-US` locale by display name, case-insensitively, with participant ID as a deterministic tie-breaker. A student's later workspace updates do not affect their roster position.
- Compatibility constraints: The manager snapshot continues to expose the same `studentCode.students` fields; only its ordering is stabilized.
- Validation rules: Normalize display names before comparison and preserve a deterministic order when names compare equally.
- Evidence (schema/tests/path): `activities/mobcode/server/routes.ts`; `activities/mobcode/server/routes.test.ts`.
- Follow-up action: Keep all manager roster views sourced from the normalized manager snapshot rather than independently sorting by activity time.
- Owner: Codex

- Date: 2026-08-01
- Surface: REST | Learn SyncDeck resource status
- Contract: An active `GET /api/integrations/learn/v1/activities/syncdeck/resources/:resourceLinkId/status` response exposes `joinCode` (the active SyncDeck session ID), `participantCount`, and `instructorCount` alongside the existing active-session status fields.
- Compatibility constraints: Existing `activeSessionId`, `studentLaunchUrl`, `connectedParticipantCount`, and `connectedInstructorCount` fields remain available. The new counts are live websocket connection counts, not attendance totals.
- Validation rules: The route authenticates the request and derives the join code only from the active server-side entry mapping. Participants are deduplicated by student ID; instructor sockets are counted individually.
- Evidence (schema/tests/path): `activities/syncdeck/server/learnIntegration.ts`; `activities/syncdeck/server/learnIntegration.test.ts`; `.agent/plans/learn-syncdeck-session-integration.md`.
- Follow-up action: Retain both field sets until Learn has migrated all consumers to the concise status shape.
- Owner: Codex

- Date: 2026-07-23
- Surface: REST | browser handoff | SyncDeck waiting room
- Contract: Learn-managed instructor sessions use a dedicated HMAC-authenticated API and a temporary `(activityId, provider, resourceLinkId)` entry mapping. The activity ID is a required URL path segment; the first implementation accepts `syncdeck`. A `student-entry` request returns a short-lived, single-use ActiveBits browser URL; consuming it establishes an httpOnly waiting-room handoff. Learn `start` transitions the mapping from waiting to active and returns a distinct single-use instructor manager handoff. `stop` broadcasts session end, clears the mapping, and leaves the stopped session to normal ActiveBits TTL cleanup.
- Compatibility constraints: The Learn HMAC secret is independent of LTI 1.1 consumer credentials. Learn owns the durable deck URL and attendance/grade history; ActiveBits stores the presentation URL only for an active mapped session and reports current websocket connection counts only. Solo uses the existing independent per-student SyncDeck launch flow.
- Validation rules: HMAC requests include method/path/timestamp/nonce/canonical-body digest and reject invalid, expired, or replayed nonces. If Valkey-backed nonce or start-lock coordination is unavailable, ActiveBits returns `503` rather than misclassifying the operational failure as a replay or transition conflict. A retry of an in-progress start with the same `requestId` returns `202 { state: "starting" }`; a different request remains a `409` conflict. Browser handoff tokens are single-use and removed from the final URL. A Start URL mismatch while active returns `409`.
- Evidence (schema/tests/path): `activities/syncdeck/server/learnIntegration.ts`; `activities/syncdeck/server/learnIntegration.test.ts`; `activities/syncdeck/client/learn/LearnSyncDeckWaitingRoom.tsx`; `.agent/plans/learn-syncdeck-session-integration.md`.
- Follow-up action: Verify the shared mapping/idempotency store provides an atomic multi-instance start transition, then add start-race and instructor-new-window browser coverage before production enablement.
- Owner: Codex

- Date: 2026-07-16
- Surface: client routing | MobCode standalone solo entry
- Contract: MobCode declares a permalink-capable standalone entry that uses `launchPersistentSoloEntry` to create a distinct server-backed workspace. It accepts optional `{ files, activeFile, runnerId }` selected options and returns a normal session route plus a scoped `mobcodeSoloToken` edit credential; the credential is not an instructor passcode.
- Compatibility constraints: Managed `/manage/mobcode/:sessionId` keeps its passcode-gated server persistence and live websocket behavior. Non-solo student sessions remain read-only. Each solo launch creates its own session, preserving its workspace state for later activity-level reporting.
- Validation rules: `POST /api/mobcode/create-solo` normalizes files using the existing path and byte limits. State writes accept either the instructor passcode or the matching solo edit token, and the session-read response never exposes either credential.
- Evidence (schema/tests/path): `activities/mobcode/activity.config.ts`; `activities/mobcode/client/index.ts`; `activities/mobcode/client/student/MobCodeStudent.tsx`; `activities/mobcode/client/manager/MobCodeManager.tsx`; `activities/mobcode/server/routes.ts`; `activities/mobcode/server/routes.test.ts`.
- Follow-up action: When SyncDeck’s parent report gains solo-child aggregation, persist an explicit parent-session and slide-instance association alongside this child session rather than inferring it from a browser overlay.
- Owner: Codex

- Date: 2026-07-14
- Surface: REST | SyncDeck utility permalink builder
- Contract: `POST /api/syncdeck/generate-url` now accepts an optional `entryPolicy` field (`instructor-required` | `solo-allowed` | `solo-only`, from `types/waitingRoom.ts`). This endpoint is called directly by the standalone `/util/syncdeck/permalink` utility page. SyncDeck's `activity.config.ts` also declares this same URL as `deepLinkGenerator.endpoint`, but that config is unused in practice: `manageDashboard.customPersistentLinkBuilder: true` makes `ManageDashboard` null out `deepLinkGenerator` for SyncDeck (`client/src/components/common/ManageDashboard.tsx` `submitPersistentLink`), so the Manage Dashboard permalink flow always posts to the generic `/api/persistent-session/create` instead. The client dropdown reuses `PERSISTENT_SESSION_ENTRY_POLICY_OPTIONS` from `client/src/components/common/persistentSessionEntryPolicyUtils.ts` via the `@src/...` alias.
- Compatibility constraints: The server resolves the field through `resolvePersistentSessionEntryPolicy` inside `buildSyncDeckPersistentLinkUrlState`, which falls back to `instructor-required` for missing/invalid values, so old clients that omit `entryPolicy` keep prior behavior. SyncDeck's `activity.config.ts` already declares `standaloneEntry.supportsPermalink: true`, so no additional per-activity solo-support gate was needed in this endpoint (unlike the generic `/api/persistent-session/create` route, which calls `validateEntryPolicyForActivity`).
- Validation rules: `entryPolicy` is written into both the returned URL query string and the `persistent_sessions` cookie entry, matching the shape already used by `/api/syncdeck/:sessionId/configure` and the generic persistent-session routes.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts` (`/api/syncdeck/generate-url`); `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/util/SyncDeckLaunchPresentation.tsx`; `activities/syncdeck/client/util/SyncDeckLaunchPresentation.test.tsx`.
- Follow-up action: None currently; if another activity utility page grows a bespoke permalink endpoint, prefer wiring it through the generic `/api/persistent-session/create` contract instead of duplicating entry-policy handling.
- Owner: Claude

- Date: 2026-07-13
- Surface: REST | activity interface | SyncDeck embedded manager bootstrap
- Contract: Every valid SyncDeck embedded child with object session data returns both `managerBootstrap` and a short-lived `managerEntryToken` from `POST /api/syncdeck/:sessionId/embedded-activity/start`. The bootstrap object may be empty for a credentialless manager such as Raffle.
- Compatibility constraints: Credentialed activities continue to exchange the single-use token for `instructorPasscode`. Credentialless managers ignore the token, but the parent still uses it to mount the iframe through the same retry and recovery lifecycle. Do not add activity-specific launch conditionals to SyncDeck shared code.
- Validation rules: The parent accepts an empty bootstrap object when it is paired with a non-empty entry token. The token exchange endpoint remains credentialed-only and must reject children with no instructor passcode.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`.
- Follow-up action: New credentialless activities should preserve object session data so they can use the shared embedded manager launch path.
- Owner: Codex

- Date: 2026-07-11
- Surface: REST | activity interface | SyncDeck report aggregation
- Contract: Postboard exposes `GET /api/postboard/:sessionId/report` as an instructor-authenticated self-contained HTML export and registers a structured report builder for SyncDeck aggregate reports. The report payload includes prompt/settings, normalized posts, reaction counts, flags, moderation status totals, hidden/deleted state, and per-student post drill-downs.
- Compatibility constraints: The standalone endpoint requires the existing `x-instructor-passcode`/body passcode path and must not be treated as student-safe. SyncDeck receives generic report blocks and the JSON-serializable report bundle through the structured builder; shared SyncDeck code should not inspect Postboard-specific session schema.
- Validation rules: Normalize session data before report generation, exclude `instructorPasscode` and raw reaction `byUser` maps from the report bundle, and keep instructor-only moderation fields such as flags inside instructor-authenticated exports only.
- Evidence (schema/tests/path): `activities/postboard/activity.config.ts`; `activities/postboard/server/routes.ts`; `activities/postboard/server/routes.test.ts`; `activities/postboard/server/reportHtml.ts`; `activities/postboard/server/reportHtml.test.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: If Postboard later supports student-owned solo proof-of-work exports, add a separate student-scoped report path that filters moderation state and peer identities.
- Owner: Codex

- Date: 2026-07-12
- Surface: SyncDeck embedded instructor managers
- Contract: Credentialed embedded manager URLs carry `embeddedManagerToken`. `useEmbeddedManagerPasscodeExchange` in `client/src/hooks/useEmbeddedManagerPasscodeExchange.ts` parses the opaque token, performs the no-store same-origin exchange after the StrictMode-safe defer, clears a successfully consumed token from the URL, and exposes passcode/resolution state to the activity.
- Compatibility constraints: Activities retain ownership of their local/cookie/bootstrap fallback credentials and manager UI; they must not duplicate the exchange request, URL cleanup, or URL parsing. The token remains a short-lived server-issued recovery credential and must not be broadened into an activity API credential. The exchange must atomically compare, check `expiresAt`, and consume `session.data.embeddedManagerEntryToken` through `SessionStore.consumeSessionDataToken`, including in Valkey-backed deployments. When an iframe is evicted, clear its completed-bootstrap marker even if no cached token exists so a later remount requests a fresh one.
- Validation rules: The parser and exchange-helper tests cover token normalization, query cleanup, request encoding, no-store credentials, invalid responses, lifecycle transitions, and cancellation. The SyncDeck exchange rejects session IDs longer than 256 characters and tokens longer than 512 characters before storage access. SyncDeck only marks a child bootstrap complete after receiving both `managerBootstrap` and a non-empty `managerEntryToken`, so incomplete responses remain eligible for retry; retry counters are isolated per child session, and after three failed attempts that child shows an explicit retry action instead of an indefinite loading state. Non-retryable embedded-start responses enter that failure state immediately; retryable errors continue with bounded retry. Evicting an iframe clears its completed marker, retry counter, and failure marker even if no cached token exists, so a later remount requests a fresh token instead of preserving stale recovery state. The active manager overlay remains visible when an evicted token is absent, even if that iframe had previously loaded, so recovery never becomes a blank panel. VideoSync, Resonance, Postboard, and MobCode use the hook; the shared Playwright spec verifies every manager in a real iframe.
- Embedded media policy: SyncDeck's internal activity iframe uses `allow="autoplay; fullscreen"` while retaining the existing sandbox tokens. This delegates the autoplay permission required for Video Sync's synchronized, muted nested YouTube playback; it does not grant the child access outside the existing sandbox.
- Evidence (schema/tests/path): `client/src/components/common/embeddedManagerBootstrap.ts`; `client/src/components/common/embeddedManagerBootstrap.test.ts`; `client/src/hooks/useEmbeddedManagerPasscodeExchange.ts`; `client/src/hooks/useEmbeddedManagerPasscodeExchange.test.ts`; `activities/syncdeck/playwright/embedded-manager-bootstrap.spec.ts`
- Follow-up action: New credentialed SyncDeck embedded activities should use this hook and add an activity-specific browser readiness assertion.
- Owner: Codex

- Date: 2026-07-11
- Surface: activity interface | SyncDeck report aggregation
- Contract: `ActivityStructuredReportSection.reportStatus` may be `available`, `unsupported`, or `unavailable`. Activity-owned structured builders should return `available` sections with generic `summaryCards`, `scopeBlocks`, `studentScopeBlocks`, and a JSON-serializable `payload` that contains any data required for offline rendering. SyncDeck session reports now include every current embedded activity with a valid parent record: child sessions without a registered builder are represented as `unsupported`, and missing or unbuildable child sessions are represented as `unavailable`.
- Compatibility constraints: `reportStatus` is optional so existing builders remain valid and are treated as available by convention. SyncDeck no longer exposes the per-child embedded report redirect path as the normal workflow; `GET /api/syncdeck/:sessionId/report` is the canonical single self-contained parent export for embedded activity sessions.
- Validation rules: Builders must normalize legacy activity state before reading it, must not include instructor passcodes, entry tokens, or other secrets, and must keep block/payload data JSON-serializable. Unsupported/unavailable sections should include visible rich-text status blocks so offline reports do not silently omit activities.
- Evidence (schema/tests/path): `types/activity.ts`; `server/activities/activityReportRegistry.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/server/reportHtml.test.ts`; `activities/resonance/server/reportRenderer.ts`; `activities/resonance/server/reportRenderer.test.ts`; `ADDING_ACTIVITIES.md`
- Follow-up action: Add structured builders for the remaining priority activities and expand the generic block vocabulary only when multiple activities need a new structure.
- Owner: Codex

- Date: 2026-06-04
- Surface: activity interface | SyncDeck embedded launch
- Contract: MobCode embedded launches may seed a starter workspace through `embeddedLaunch.selectedOptions` using `{ files: Record<string, string>, activeFile?: string }`. `files` is a virtual path to UTF-8 text map, and `activeFile` is optional.
- Compatibility constraints: The starter payload is only used when a MobCode child session is created without an explicit `groups.default` workspace. Once live MobCode state exists, `groups.default.files` and `groups.default.activeFile` remain authoritative so reloads do not overwrite instructor edits or intentionally emptied workspaces.
- Validation rules: Paths are normalized to safe relative paths, file content is truncated to MobCode's existing per-file and total UTF-8 byte limits, and invalid/traversal paths are dropped. If `activeFile` is missing or invalid, MobCode falls back to the first valid file path.
- Evidence (schema/tests/path): `activities/mobcode/server/routes.ts`; `activities/mobcode/server/routes.test.ts`; `activities/syncdeck/server/routes.test.ts`; `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`
- Follow-up action: If MobCode later needs richer embedded bootstrap data such as language/tooling hints, extend the launch object under explicit new keys rather than overloading `files` entries with metadata.
- Owner: Codex

- Date: 2026-06-03
- Surface: REST | activity interface | file import
- Contract: Resonance managers can append saved question sets into an active live session through `POST /api/resonance/:sessionId/import-questions` with `{ questions }` and the instructor passcode header. The payload uses the same JSON question-set shape exported by the Resonance tools page and is normalized through `validateQuestionSet(...)` before persistence.
- Compatibility constraints: Question ids are only unique within an authored question set, not globally unique across files. Import preserves existing session questions, rewrites any incoming question id that already exists in the session, appends all imported questions after the current list, and does not clear live responses, active runs, reveals, or drafts.
- Validation rules: Invalid question sets return `400`; successful imports return `remappedQuestionIds` for any incoming id collisions and broadcast updated instructor/student snapshots.
- Evidence (schema/tests/path): `activities/resonance/server/routes.ts`; `activities/resonance/server/routes.test.ts`; `activities/resonance/client/manager/ResonanceManager.tsx`; `activities/resonance/client/tools/ResonanceQuestionSetUploader.test.ts`
- Follow-up action: If teachers later need a true replace-session-question-set action that removes missing questions, add an explicit destructive route that deliberately handles dependent response/reveal/active-run cleanup instead of overloading import.
- Owner: Codex

- Date: 2026-06-02
- Surface: activity interface | client routing
- Contract: Activities may set `studentLayout.expandShell: true` to request the app shell omit its default page padding once `SessionRouter` resolves a live student session to that activity. `manageLayout.expandShell` remains for instructor manager routes, and `standaloneLayout.expandShell` remains for direct standalone routes where the activity id is already available in the URL.
- Compatibility constraints: Live join routes such as `/:sessionId` cannot know the activity from the URL alone, so padding must be driven after the session payload resolves instead of adding activity-specific route exceptions in `AppShell`.
- Validation rules: `studentLayout.expandShell` is parsed with the same boolean-only shape as the existing layout configs.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/App.tsx`; `client/src/components/common/SessionRouter.tsx`; `server/activityConfigSchema.test.ts`
- Follow-up action: Use `studentLayout` for future full-bleed live student activities rather than compensating with negative margins inside activity UI.
- Owner: Codex

- Date: 2026-06-02
- Surface: activity interface | SyncDeck embedded launch | file import
- Contract: Resonance question stem fields (`text`) and multiple-choice answer choice fields (`options[].text`) are plain strings interpreted as Markdown at render time. No parallel `markdown` schema field is introduced, so existing plain-text payloads remain valid and stored/imported question sets keep the same shape.
- Compatibility constraints: Markdown is additive and activity-owned. Student free-response answer text remains plain escaped user text, not authored Markdown. SyncDeck deck authors can put Markdown directly in embedded Resonance `questions[].text` and `questions[].options[].text` values.
- Validation rules: Resonance trims and requires non-empty strings, then caps question stems and MCQ options at `MAX_QUESTION_TEXT_LENGTH` and `MAX_MCQ_OPTION_TEXT_LENGTH` respectively to support code, tables, and data URL images while keeping finite payload bounds.
- Evidence (schema/tests/path): `activities/resonance/shared/validation.ts`; `activities/resonance/shared/validation.test.ts`; `activities/resonance/client/components/FormattedMarkdown.tsx`; `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`
- Follow-up action: If future activities need formatted prompts, define a shared generic contract only after a second activity adopts the pattern.
- Owner: Codex

- Date: 2026-06-02
- Surface: REST | websocket | activity interface | SyncDeck embedded launch
- Contract: Resonance question sets may carry `presentationMode: 'standard' | 'staged'`. Standard mode preserves simultaneous active-question behavior. Staged mode presents one active question at a time through `stagedRun`, hides multiple-choice options from student snapshots until choices are revealed, and starts the question timer when choices become answerable. SyncDeck embedded `activityOptions` may include `presentationMode: 'staged'` alongside `questions` and `autoActivateAllQuestions`.
- Compatibility constraints: Missing or malformed presentation mode defaults to `standard`. Existing `activeQuestionId`, `activeQuestionIds`, `activeQuestionRunStartedAt`, and `activeQuestionDeadlineAt` remain populated for the current staged question so older activation refresh paths continue to work. Student-safe MCQ snapshots use `choicesRevealed: false` plus an empty `options` array during the stem-only phase.
- Validation rules: Student submissions and drafts for an unrevealed staged multiple-choice question are rejected/ignored server-side. Free-response questions do not require a reveal phase in staged runs.
- Evidence (schema/tests/path): `activities/resonance/shared/types.ts`; `activities/resonance/shared/validation.ts`; `activities/resonance/server/routes.ts`; `activities/resonance/client/hooks/useResonanceSession.ts`; `activities/resonance/client/hooks/useInstructorState.ts`; `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`
- Follow-up action: If mixed standard/staged behavior within the same question set becomes a requirement, add explicit per-question metadata rather than overloading the set-level mode.
- Owner: Codex

- Date: 2026-05-12
- Surface: REST | activity interface
- Contract: Video Sync instructor iframe seeks should be persisted by sending the current play-state command (`play` or `pause`) with `positionSec` when the iframe reports the same playback state at a new position. The raw `seek` command remains a pause-oriented command and should not be used for manager-side scrubbing while playback should continue.
- Compatibility constraints: Manager-side YouTube controls may emit `PLAYING` or `PAUSED` without a play-state transition after the instructor drags the iframe slider. Treat a meaningful position delta as a command-worthy update even when `state.isPlaying` already matches the reported intent.
- Validation rules: Ignore missing positions and in-tolerance deltas; send a position-bearing `play`/`pause` command for larger deltas so subsequent server snapshots do not snap the instructor and students back to the previous position.
- Evidence (schema/tests/path): `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `activities/video-sync/server/routes.ts`
- Follow-up action: If the server `seek` command semantics change to preserve play state, update this contract and the manager command-selection tests together.
- Owner: Codex

- Date: 2026-05-08
- Surface: activity interface | internal module
- Contract: Binary Breach challenges now carry `promptEmphasis`, and order-binary challenges carry `direction: 'least-to-greatest' | 'greatest-to-least'`. The student UI bolds the `promptEmphasis` substring inside the prompt, and validation uses `direction` as authoritative for sorted-answer order.
- Compatibility constraints: Persisted pre-field challenges are normalized on session read. Missing `promptEmphasis` is reconstructed from the challenge type when possible, and legacy order-binary challenges default to `least-to-greatest`.
- Validation rules: Order-binary answers must match `challenge.answer` exactly after binary normalization; descending challenges store `answer` in greatest-to-least order, not ascending order plus a display flag.
- Evidence (schema/tests/path): `activities/binary-breach/binaryBreachTypes.ts`; `activities/binary-breach/shared/challengeGenerator.ts`; `activities/binary-breach/shared/challengeGenerator.test.ts`; `activities/binary-breach/server/routeUtils.ts`; `activities/binary-breach/server/routeUtils.test.ts`; `activities/binary-breach/client/student/BinaryBreachStudent.tsx`
- Follow-up action: Add any future prompt-highlighting fields to the challenge contract rather than embedding markup in prompt strings.
- Owner: Codex

- Date: 2026-05-08
- Surface: REST | websocket | activity interface
- Contract: Binary Breach mission reset has two activity-owned scopes. `POST /api/binary-breach/:sessionId/mission/new` is instructor/class scoped: it creates a fresh `missionSeed`, resets every student progress record, and broadcasts `binary-breach:mission-reset` with each connected student's own current challenge. `POST /api/binary-breach/:sessionId/student/retry` is student scoped: it resets only the requesting student against the current active mission seed/settings.
- Compatibility constraints: Student retry must not rotate `missionSeed` or disturb other students. Manager new mission must preserve session settings and roster identity while resetting progress/challenge state. Reconnecting students recover the current mission from stored session state through the existing register route.
- Validation rules: Both reset paths use normal Binary Breach session normalization and student identity validation; reset progress returns to `createInitialProgress()` and challenge index `0`.
- Evidence (schema/tests/path): `activities/binary-breach/server/routes.ts`; `activities/binary-breach/server/routes.test.ts`; `activities/binary-breach/client/manager/BinaryBreachManager.tsx`; `activities/binary-breach/client/student/BinaryBreachStudent.tsx`
- Follow-up action: If instructor auth is later added to Binary Breach manager routes, apply it consistently to settings and mission reset endpoints together.
- Owner: Codex

- Date: 2026-05-08
- Surface: activity interface | client bootstrap
- Contract: Shared activity `deepLinkOptions` may now describe common permalink/embed controls with `text`, `select`, `number`, `checkbox`, and `multiselect` field types. Values still canonicalize to string selected-options records; multiselect values use a comma-separated string, and checkbox values use `"true"` / `"false"`.
- Compatibility constraints: Existing text/select options remain unchanged. Activities that need richer or protocol-specific setup can still use `manageDashboard.customPersistentLinkBuilder`, but simple dashboard-like settings should prefer the generic fields so the same selected-options contract works for persistent links, `/launch` query params, and SyncDeck embedded `activityOptions`.
- Validation rules: Number fields may enforce finite `min`/`max`; multiselect values are filtered/validated against declared option values; URL validators continue to require valid http(s) URLs.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `server/activityConfigSchema.test.ts`; `ARCHITECTURE.md`; `ADDING_ACTIVITIES.md`
- Follow-up action: If activities need labels/help text per option beyond current fields, extend the generic option schema rather than adding one-off dashboard controls.
- Owner: Codex

- Date: 2026-05-08
- Surface: activity interface | SyncDeck embedded launch
- Contract: Binary Breach consumes mission setup from `embeddedLaunch.selectedOptions` using the same keys exposed in its permalink builder: `maxBits`, `missionLength`, `challengeTypes`, `hintsEnabled`, and `placeValueSupport`.
- Compatibility constraints: Stored `session.data.settings` remains authoritative once present, so manager edits are not overwritten by launch options after session creation. Missing launch fields fall back through normal Binary Breach defaults.
- Validation rules: `challengeTypes` may arrive as a comma-separated string and normalizes to the supported challenge-type array. `hintsEnabled` string `"false"` disables hints; all other malformed values fall back safely.
- Evidence (schema/tests/path): `activities/binary-breach/activity.config.ts`; `activities/binary-breach/server/routeUtils.ts`; `activities/binary-breach/server/routeUtils.test.ts`; `activities/binary-breach/server/routes.test.ts`; `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`
- Follow-up action: Keep Binary Breach deck examples aligned with activity config if future challenge types or settings are added.
- Owner: Codex

- Date: 2026-04-17
- Surface: activity interface | websocket | internal module
- Contract: SyncDeck student-side instructor sync suppression must derive incoming slide indices from all Reveal state shapes that can drive a `setState`, including `payload.indices`, `payload.navigation.current`, `payload.revealState`, and top-level state fields. Same-horizontal vertical instructor moves must remain suppressible even when the deck emits `revealState` without a separate `indices` object.
- Compatibility constraints: `toRevealCommandMessage(...)` may still convert `revealState`-only state envelopes into `setState` commands for normal instructor follow behavior, but the suppression decision must read the same position source first so released vertical stacks stay student-independent.
- Validation rules: A `revealState` payload with `indexh/indexv/indexf` is equivalent to `indices.h/v/f` for sync suppression and released-slide state tracking.
- Evidence (schema/tests/path): `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: Keep future Reveal state-envelope parsers aligned so command conversion and suppression decisions do not drift.
- Owner: Codex

- Date: 2026-04-17
- Surface: REST | websocket | activity interface
- Contract: SyncDeck's embedded Resonance auto-activation endpoint must both persist the child-session activation and notify already-connected Resonance clients with a `resonance:question-activated` websocket event. Persisting `embeddedLaunch.selectedOptions.autoActivateAllQuestions` alone is not enough once the embedded Resonance iframe has already completed its initial REST fetch and websocket connection.
- Compatibility constraints: SyncDeck only sends this activity-specific wake-up after it has confirmed the child session is Resonance and normalization produced active question ids. Resonance clients continue to own the full state refresh after receiving the event.
- Validation rules: The notification payload uses the existing Resonance activation event shape: `{ questionId, questionIds, deadlineAt }`.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/resonance/client/hooks/useResonanceSession.ts`
- Follow-up action: If more embedded activities need parent-triggered child runtime changes, extract a generic child notification contract instead of adding unrelated activity-specific messages to SyncDeck.
- Owner: Codex

- Date: 2026-04-17
- Surface: activity interface | client bootstrap
- Contract: When a SyncDeck instructor lands on the top slide of a vertical stack, the manager should prestart embedded activities declared on child slides in that stack. For embedded Resonance stack children, SyncDeck adds the one-shot `selectedOptions.autoActivateAllQuestions` launch flag so students who independently navigate down can answer immediately without requiring the instructor to visit the child slide.
- Compatibility constraints: This manager-side deck scan is a fallback for decks/runtimes that do not emit a primary `activityRequest` or `activityPreloadRequest` from the stack parent when only a child slide contains `data-activity-id`. It depends on the presentation URL being fetchable with browser CORS; decks that already emit explicit stack requests continue through the normal preload path.
- Validation rules: Vertical child anchors derive the instance key from the current deck structure as `activityId:h:v`, ignoring stale `data-activity-instance-key` values so moved slides remain aligned with runtime-generated requests and student overlay lookup. Malformed `data-activity-options` is ignored rather than blocking other stack children.
- Evidence (schema/tests/path): `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Keep deck runtime stack preload emission and manager-side fallback behavior aligned; if runtime stack requests become universal, this fallback can remain as a defensive compatibility path.
- Owner: Codex

- Date: 2026-04-07
- Surface: internal module | activity interface
- Contract: Uploaded Resonance report JSON is normalized before rendering. Multiple-choice report answers trim each `selectedOptionIds` entry and deduplicate repeated ids so imported reports cannot double-count option selections or inflate correct-response totals.
- Compatibility constraints: Legacy uploaded report payloads that still use singular `selectedOptionId` remain accepted and are normalized into `selectedOptionIds`. Deduplication preserves first-seen order rather than rejecting the whole report so older or hand-edited exports still load.
- Validation rules: Uploaded MCQ answers must contain at least one non-empty string option id after trimming. Duplicate ids collapse to one normalized entry.
- Evidence (schema/tests/path): `activities/resonance/client/tools/ResonanceReport.tsx`; `activities/resonance/client/tools/ResonanceReport.test.ts`
- Follow-up action: If report exports become versioned separately from live session payloads, keep this normalization behavior documented in the report schema so imports stay stable across tools.
- Owner: Codex

- Date: 2026-04-07
- Surface: REST | websocket | internal module | activity interface
- Contract: Resonance multiple-choice answers now persist as `{ type: 'multiple-choice', selectedOptionIds: string[] }`. Student-safe question payloads also include `selectionMode: 'single' | 'multiple'`, derived from the authored option set: zero or one correct options yields `single`, while two or more correct options yields `multiple`.
- Compatibility constraints: Existing stored/session/report payloads that still use legacy `selectedOptionId` should be normalized forward to `selectedOptionIds` where those payloads are parsed. Poll-style MCQs remain single-select even though they have no correct answers.
- Validation rules: Single-select MCQs accept exactly one selected option id. Multi-select MCQs accept one or more unique valid option ids. Correctness is an exact-set match against the authored correct option ids; partial selections are valid submissions but are scored incorrect.
- Evidence (schema/tests/path): `activities/resonance/shared/types.ts`; `activities/resonance/shared/mcq.ts`; `activities/resonance/shared/validation.ts`; `activities/resonance/server/routes.ts`; `activities/resonance/client/student/MCQInput.tsx`; `activities/resonance/client/manager/ResponseViewer.tsx`
- Follow-up action: Keep any future embedded Resonance launch docs aligned with the derived `selectionMode` behavior instead of introducing a parallel explicit mode flag unless authoring requirements change.
- Owner: Codex

- Date: 2026-03-26
- Surface: activity interface | internal module
- Contract: SyncDeck student released-slide auto-activation for embedded Resonance uses a one-shot embedded launch option `selectedOptions.autoActivateAllQuestions`. SyncDeck sets that flag only when the active embedded Resonance slide is considered released for the student: any anchored vertical stack slide with `v > 0`, or a horizontally released student-anchored slide that is not the instructor's locked current slide and is not being visited under backtrack opt-out.
- Compatibility constraints: SyncDeck owns the released-slide detection and may request the flag multiple times, but the flag is best-effort and should only matter for the first embedded bootstrap of a given Resonance child session. Resonance owns converting that flag into an initial "all questions active" run, must clear/consume the flag, and must persist a durable marker so later manual deactivation does not re-enable all questions on reload or after a repeated SyncDeck request.
- Validation rules: SyncDeck's student-triggered auto-activate request must map to a registered parent-session student and only target an existing embedded child session for that `instanceKey`. Since SyncDeck does not currently persist student navigation indices server-side, release authorization is derived from the requested `instanceKey` plus the parent session's instructor reveal position: anchored vertical stack slides with `v > 0` are only treated as released when their horizontal index is at or behind the instructor's current `h`, while horizontal slides require `instanceKey.h < instructor.h`. Resonance should activate questions in their stored order, reuse normal countdown aggregation logic, and leave non-Resonance embedded activities untouched.
- Evidence (schema/tests/path): `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/resonance/server/routes.ts`; `activities/resonance/server/routes.test.ts`
- Follow-up action: If another embedded activity needs released-slide bootstrap behavior, prefer adding a generic child-launch flag contract rather than teaching SyncDeck server routes more activity-specific mutation rules.
- Owner: Codex

- Date: 2026-03-26
- Surface: activity interface | internal module
- Contract: SyncDeck's reveal iframe embedded-preload protocol is split into two iframe-to-host actions. `activityPreloadRequest` is for non-student hosted roles that may prewarm both client bundles and embedded child sessions, while `activityBundlePreloadRequest` is a bundle-only hint that any hosted role, including students, may emit. Both payloads carry grouped `requests` entries that reuse the `activityRequest` shape, including nested `stackRequests`.
- Compatibility constraints: Hosts must treat both actions as best-effort preload hints and continue to rely on the normal `activityRequest` flow as the authoritative launch path. Student-follow views must never interpret bundle-only preload hints as permission to create child sessions. Repeated preload emissions for the same anchored `instanceKey` are expected and should remain idempotent.
- Validation rules: Each grouped request entry requires a non-empty `activityId`; `instanceKey` may be derived from `activityId` plus slide anchor when omitted; malformed grouped entries should be ignored without dropping valid siblings; bundle preloads may silently no-op for unknown activities.
- Evidence (schema/tests/path): `.agent/knowledge/reveal-iframe-sync-message-schema.md`; `activities/syncdeck/client/shared/groupedActivityRequests.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `client/src/activities/index.ts`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If hosted standalone mode later gains a session-prestart path distinct from the current solo-overlay flow, extend this contract deliberately instead of letting student-side bundle preload handling implicitly create sessions.
- Owner: Codex

- Date: 2026-03-23
- Surface: activity interface | internal module
- Contract: SyncDeck's reveal iframe sync protocol now reserves an iframe-to-host `metadata` action with object payloads such as `{ title }`. Hosts must treat the payload as optional descriptive metadata, trim string values, ignore unknown keys, and avoid using `metadata` as the iframe-ready handshake.
- Compatibility constraints: Existing `ready` and `state` bootstrap behavior remains authoritative for host restore/replay timing. Older decks that never emit `metadata` remain fully supported; title updates are best-effort only until iframe libraries adopt the new message.
- Validation rules: `payload.title` is only usable when it is a non-empty trimmed string. Empty strings and non-string values normalize to absent metadata.
- Evidence (schema/tests/path): `activities/syncdeck/shared/revealSyncProtocol.ts`; `activities/syncdeck/client/shared/presentationMetadata.ts`; `activities/syncdeck/client/shared/presentationMetadata.test.ts`; `.agent/knowledge/reveal-iframe-sync-message-schema.md`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: When `reveal-iframe-sync.js` is updated, have it emit `metadata` near deck initialization so manager and student titles can populate without same-origin DOM access.
- Owner: Codex

- Date: 2026-03-22
- Surface: activity interface | client bootstrap
- Contract: SyncDeck embedded manager bootstrap payloads are one-shot transport data. Child managers that recover instructor credentials from `consumeCreateSessionBootstrapPayload(...)` must persist those credentials into their normal per-session storage key on first use if they need manager auth to survive later unmount/remount cycles in the same tab.
- Compatibility constraints: This especially matters for embedded activities that can be revisited from multiple slides or by leaving and returning to the same slide. Student runtime state may still persist correctly even when manager auth would otherwise be lost, so missing persistence can present as an instructor-only regression.
- Validation rules: A recovered bootstrap instructor passcode must be treated the same as a dashboard-provided passcode for same-tab re-entry. Do not rely on the bootstrap payload remaining available after first consumption.
- Evidence (schema/tests/path): `activities/resonance/client/manager/ResonanceManager.tsx`; `activities/resonance/client/manager/ResonanceManager.test.ts`; `client/src/components/common/manageDashboardUtils.ts`
- Follow-up action: Reuse the same persistence pattern for any other embedded child managers that currently consume bootstrap payloads without writing them into their activity-owned session storage.
- Owner: Codex

- Date: 2026-03-21
- Surface: file import | internal module | activity interface
- Contract: `parseGimkitCSV(...)` must always return `Question` objects that have passed through `validateQuestionSet(...)`, even when some CSV rows produced row-level parse errors. The parser should merge row errors with set-validation errors instead of returning pre-normalized successful rows early.
- Compatibility constraints: Resonance uploader flows treat `errors.length > 0 && questions.length > 0` as a partial-import state, so preserving normalized successful rows is important for UX. Successful CSV rows must receive the same trimming, length caps, and structural filtering as JSON imports and decrypted question sets.
- Validation rules: Gimkit row-level requirements still apply first (required prompt/correct answer, 1-3 incorrect answers, max 100 parsed rows). After accumulation, all surviving rows run through `validateQuestionSet(...)`; any resulting validation errors are appended to the returned `errors`.
- Evidence (schema/tests/path): `activities/resonance/shared/validation.ts`; `activities/resonance/shared/validation.test.ts`; `activities/resonance/client/tools/ResonanceQuestionSetUploader.tsx`
- Follow-up action: If CSV import ever needs row-specific set-validation messages, preserve this normalization-first contract and add row metadata to the accumulated errors rather than bypassing `validateQuestionSet(...)`.
- Owner: Codex

- Date: 2026-03-21
- Surface: REST | client normalizer | activity interface
- Contract: Resonance student `/state` reveal payloads may include `QuestionReveal.viewerResponse` with `{ answer, submittedAt, instructorEmoji, isShared }`, and the client-side `normalizeStudentSessionSnapshot` path must preserve that object when each field validates successfully.
- Compatibility constraints: `viewerResponse` is optional and may be `null`, but when present it is the only student-safe source for "Your response" summary and correct/incorrect reveal UI in `SharedResponseFeed`. Dropping it in normalization is a behavior regression even when `sharedResponses` still render. `sharedResponses[*].reactions` is also rendered directly, so the client normalizer must not trust arbitrary transport values there.
- Validation rules: `viewerResponse.answer` must satisfy the existing `AnswerPayload` contract; `submittedAt` must be a finite number; `instructorEmoji` must be `string | null`; `isShared` must be boolean. Invalid `viewerResponse` invalidates the containing reveal during normalization. `sharedResponses[*].reactions` is sanitized to a `Record<string, number>` by keeping only known student reaction emoji keys with finite non-negative numeric counts; invalid keys/counts are dropped rather than invalidating the whole response.
- Evidence (schema/tests/path): `activities/resonance/shared/types.ts`; `activities/resonance/server/routes.ts`; `activities/resonance/client/hooks/useResonanceSession.ts`; `activities/resonance/client/hooks/useResonanceSession.test.ts`; `activities/resonance/client/student/SharedResponseFeed.tsx`
- Follow-up action: Keep any future student snapshot normalizers aligned with `buildStudentReveal(...)` so student-only enrichment fields do not get stripped on reload/poll paths.
- Owner: Codex

- Date: 2026-03-20
- Surface: activity interface | internal module
- Contract: Custom persistent-link builders cannot rely on `selectedOptions` retaining nested objects/arrays across the shared persistent-link pipeline; stored/edit-state options are normalized to allowed deep-link keys and string values. `activities/resonance/client/tools/ResonancePersistentLinkBuilder.tsx` now recovers editable question drafts from local storage keyed by persistent-link hash (`resonance-question-draft:<hash>`) instead of relying on `selectedOptions.questions` round-tripping.
- Compatibility constraints: Resonance edit mode pre-population now depends on a same-browser local cache entry for the hash. Missing cache falls back gracefully to empty uploader state and does not break link editing.
- Validation rules: Cached payload is parsed through `validateQuestionSet` before use; malformed/invalid cache entries are removed.
- Evidence (schema/tests/path): `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `activities/resonance/client/tools/ResonancePersistentLinkBuilder.tsx`; `activities/resonance/client/tools/resonanceQuestionDraftCache.ts`; `activities/resonance/client/tools/resonanceQuestionDraftCache.test.ts`
- Follow-up action: If cross-device or long-lived edit recovery is required, add a teacher-authenticated server endpoint to retrieve/decrypt question sets by hash and treat local cache as best-effort only.
- Owner: Codex

- Date: 2026-03-20
- Surface: internal module | activity interface
- Contract: `activities/resonance/shared/validation.ts` `validateQuestionSet(raw)` treats duplicate question ids as invalid set-level input. If duplicate normalized question ids are detected, it returns `{ questions: [], errors: ['question ids must be unique within a set'] }` instead of returning a partially valid array that still contains conflicting ids.
- Compatibility constraints: Downstream resonance session state and response lookup paths key by `question.id`, so callers may assume a non-empty `questions` result has unique ids. This is stricter than row-level CSV-style partial acceptance; duplicate-id failure invalidates the whole set.
- Validation rules: Individual question normalization still happens first, but any duplicate in the resulting normalized ids escalates to a set-level failure. Callers should treat `errors.length > 0` or `questions.length === 0` as invalid import input for this case.
- Evidence (schema/tests/path): `activities/resonance/shared/validation.ts`; `activities/resonance/shared/validation.test.ts`
- Follow-up action: If resonance later wants partial acceptance for duplicate ids, it will need a different contract that rewrites ids or reports per-id skips without exposing duplicate keys to session consumers.
- Owner: Codex

- Date: 2026-03-18
- Surface: activity interface | internal module
- Contract: `ActivityConfig.reportEndpoint?: string` declares an activity-owned standalone report download route. The value is metadata only; shared code treats it as an opaque non-empty string path and leaves auth, response format, and report generation semantics to the owning activity.
- Contract update: Embedded report downloads should resolve to one self-contained HTML file per activity session. The HTML should embed all required data, styles, and scripts and support internal view switching (for example whole-class summary and per-student detail) without extra network fetches.
- Contract update: SyncDeck no longer exposes a shared per-child embedded report redirect route. The parent report is generated from structured activity builders and downloaded from `GET /api/syncdeck/:sessionId/report`.
- Contract update: Per-activity report downloads are now a lower-level building block. The product-level target is a SyncDeck parent-session report that aggregates results from all embedded activities in a session into one downloadable self-contained HTML report with cross-activity summary, per-activity drill-down, and per-student drill-down.
- Contract update: The aggregate-path contract is structured-data-first. Child activities should contribute `ActivityStructuredReportSection` data plus an optional `ReportSectionComponent`, while SyncDeck owns the outer session-report container, scope selection, and manifest. Scopes currently planned are `activity-session`, `student-cross-activity`, and `session-summary`.
- Contract update: Structured child-report aggregation now uses a shared server registry (`registerActivityReportBuilder(activityType, builder)`). SyncDeck's `GET /api/syncdeck/:sessionId/report-manifest` route authenticates the parent instructor, walks `embeddedActivities`, invokes any registered child report builders, and returns a `SyncDeckSessionReportManifest` with deduplicated student refs.
- Contract update: SyncDeck manager now surfaces the parent-session export directly through a `Download Session Report` action that calls `GET /api/syncdeck/:sessionId/report` with the instructor passcode header and saves the returned self-contained HTML file locally.
- Contract update: Structured child report sections may now provide generic `scopeBlocks` and `studentScopeBlocks` in addition to summary cards. These blocks are activity-owned structured content (`rich-text` and `table` initially) that the SyncDeck session-report shell renders for `session-summary`, `activity-session`, and per-student drill-down views without importing activity-specific presentation code.
- Compatibility constraints: The field is optional and additive. Activities without reporting support omit it entirely. Shared parsers remove `null` values and reject non-string shapes so config loading stays deterministic. Standalone report routes should return downloadable HTML, but shared SyncDeck aggregation must not depend on activity-specific DOM structure inside that document.
- Validation rules: `reportEndpoint` must be a non-empty string when present. Report documents should not depend on CDN assets, server-side templates that fetch follow-up JSON, or multiple companion files. The exported HTML should remain understandable when opened directly from disk after download. `scopeBlocks` and `studentScopeBlocks` must stay JSON-serializable and activity-agnostic enough for shared rendering.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `server/activityConfigSchema.test.ts`; `ARCHITECTURE.md`; `ADDING_ACTIVITIES.md`; `server/activities/activityReportRegistry.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/server/reportHtml.ts`; `activities/syncdeck/server/reportHtml.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/gallery-walk/activity.config.ts`; `activities/gallery-walk/server/reportHtml.ts`; `activities/gallery-walk/server/reportHtml.test.ts`; `activities/gallery-walk/server/reportRoute.test.ts`
- Follow-up action: Expand the generic block vocabulary only when a second activity needs additional structures; avoid pushing activity-specific markup conventions into shared SyncDeck code.
- Owner: Codex

- Date: 2026-03-18
- Surface: REST | internal module | activity interface
- Contract: SyncDeck embedded child launches persist a generic bootstrap envelope on the child session at `session.data.embeddedLaunch = { parentSessionId, instanceKey, selectedOptions }`. The parent `POST /api/syncdeck/:sessionId/embedded-activity/start` route sanitizes object-shaped `activityOptions` into `selectedOptions`, and child activities consume that payload through shared client bootstrap helpers instead of SyncDeck-specific props or query params.
- Compatibility constraints: `selectedOptions` must remain activity-agnostic and JSON-serializable so any embedded activity can adopt the same bootstrap path. Missing, malformed, or non-object `activityOptions` normalize to `{}` rather than failing launch. Existing permalink/create-session bootstrap flows stay intact; embedded bootstrap is an additive read path for child-session managers.
- Validation rules: Parent route stores only sanitized object data; child readers treat absent or malformed `embeddedLaunch.selectedOptions` as `null`/no bootstrap; activity-specific validation still belongs inside the child activity. `video-sync` currently treats `selectedOptions.sourceUrl` as optional launch intent and falls back to its existing manual/permalink setup flow when invalid or absent.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `client/src/components/common/embeddedLaunchBootstrap.ts`; `client/src/components/common/embeddedLaunchBootstrap.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`
- Follow-up action: Add higher-level manager tests covering bootstrap-driven auto-configuration after child reload, then document any additional shared bootstrap fields only when a second embedded activity needs them.
- Owner: Codex

- Date: 2026-03-17
- Surface: REST | websocket | activity interface
- Contract: SyncDeck embedded child launch reuses waiting-room entry contracts plus parent-context proof. Parent session validates inherited role/identity through `POST /api/syncdeck/:sessionId/embedded-context`, child entry uses the shared child gateway (`GET /api/session/:childSessionId/entry` + entry-participant token consume), and parent SyncDeck state exposes an `embeddedActivities` map keyed by `instanceKey` (`{activityId}:{h}:{v}` or `{activityId}:global`).
- Contract update: Embedded pass-through is explicit: when child entry resolves to `entryOutcome: 'join-live'` and `waitingRoomFieldCount === 0`, overlay launch skips waiting-room UI by default. Two gating modes override this: `instructorGated: 'runtime'` skips waiting-room UI but holds students in instructor-owned state inside the activity; `instructorGated: 'waiting-room'` forces the waiting-room hold UI even with zero fields.
- Contract update: Multiplexing is not supported for embedded child activity realtime traffic. SyncDeck parent websocket only carries lifecycle envelopes (`embedded-activity-start` / `embedded-activity-end` keyed by `instanceKey`), while each active child activity/session maintains its own websocket connection to that activity server path.
- Compatibility constraints: Embedded launch must not introduce a parallel child claim API that bypasses shared waiting-room/accepted-entry seams. Parent websocket lifecycle envelopes must remain activity-agnostic and include `instanceKey`, `activityId`, and `childSessionId`; per-student `entryParticipantToken` remains nullable (for example manager role).
- Validation rules: `embeddedActivities` snapshot entries are map values shaped as `{ childSessionId, activityId, startedAt, owner }`. Late join/reconnect must request a fresh entry-participant token through parent-context-validated SyncDeck issuance instead of reusing an expired startup token.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/shared/embeddedContextUtils.ts`; `server/sessionEntryRoutes.test.ts`; `.agent/plans/syncdeck-embedded-activities.md`; `types/activity.ts`; `types/activityConfigSchema.ts`
- Follow-up action: Phase 1 should formalize lifecycle message payload interfaces in shared SyncDeck types and add server tests covering per-instance deduplication, owner arbitration, late-join token issuance, and parent-cull child teardown.
- Owner: Codex

- Date: 2026-03-03
- Surface: internal module
- Contract: `activities/video-sync` treats a valid YouTube video ID as exactly 11 URL-safe characters (`[A-Za-z0-9_-]{11}`) in both client-side URL parsing and server-side source validation.
- Compatibility constraints: Solo-mode parsing, managed session configuration, and shared URL parsing helpers should reject shorter IDs the same way; any intentional divergence would need explicit documentation because it changes behavior between solo and teacher-managed flows.
- Validation rules: `parseYouTubeVideoId()` and the server `normalizeYouTubeVideoId()` path should only accept 11-character IDs and return `null`/`invalid-video-id` for shorter or malformed values.
- Evidence (schema/tests/path): `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/student/VideoSyncStudent.test.ts`; `activities/video-sync/server/routes.ts`
- Follow-up action: Reuse the same 11-character rule in any future client-side Video Sync URL validation helpers instead of introducing activity-local regex variants.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: Shared server-side participant IDs now originate from `generateParticipantId()` in `server/core/participantIds.ts`, which returns a 16-character lowercase hex token. Activity server routes may still store that value under existing field names such as `studentId` or `id`, but new ID minting should come from the shared helper instead of route-local timestamp/random concatenation.
- Compatibility constraints: Existing websocket and REST payload keys remain unchanged for now (`studentId`, `id`, etc.) so activity clients do not break. This contract centralizes only issuance format, not yet the higher-level participant context schema or reconnect ownership.
- Validation rules: Generated IDs must match `/^[a-f0-9]{16}$/` and be random enough for repeated issuance without route-local prefixes or user-name-derived content.
- Evidence (schema/tests/path): `server/core/participantIds.ts`; `server/participantIds.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/shared.ts`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: Replace activity-owned reconnect matching and participant record creation with a shared participant-entry contract once waiting-room/server handoff design is ready.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: `connectSessionParticipant()` in `server/core/sessionParticipants.ts` now provides a shared reconnect-or-create flow for session-backed student arrays whose records use `{ id?, name, connected?, lastSeen? }` plus activity-specific extra fields. It resolves by explicit participant ID first and can optionally support legacy name-only matches for older sessions missing IDs.
- Compatibility constraints: The helper does not change activity wire formats; routes still send existing payload keys such as `studentId`. It only centralizes in-memory/session-store mutation rules for activities that opt in.
- Validation rules: Existing participant IDs win over name matches; legacy name fallback is only enabled where explicitly requested; reconnect updates `connected` and `lastSeen`; missing IDs on matched legacy participants are backfilled with a generated shared participant ID.
- Evidence (schema/tests/path): `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`.
- Follow-up action: Extend or replace this helper once Python List Practice and SyncDeck are migrated to the same participant contract, especially where their current flows still mix registration, reconnect, and progress persistence differently.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: The current waiting-room branch treats `participantId` as shared early identity, but not yet as a fully authoritative accepted-entry contract. Shared code now covers ID issuance, entry handoff storage, reconnect/create for several session-backed activities, accepted-participant lookup, mutation, disconnect handling, and duplicate-socket replacement. Activity routes still own the final acceptance and persistence boundary after handoff.
- Compatibility constraints: Existing activities may continue to use activity-owned registration or acceptance flows as long as they do not break the earlier shared `participantId` and handoff assumptions. Separate `studentId` vs `id` field names remain tolerated for now.
- Validation rules: Waiting-room handoff may mint `participantId` before activity startup, but an activity may only treat that identity as authoritative after its own accepted-entry checks succeed. Shared helpers should be preferred for session-backed participant lookup/mutation where the participant record fits the common shape.
- Evidence (schema/tests/path): `server/core/participantIds.ts`; `server/core/entryParticipants.ts`; `server/core/sessionParticipants.ts`; `server/core/participantSockets.ts`; `server/sessionParticipants.test.ts`; `server/participantSockets.test.ts`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/entryParticipantIdentityUtils.ts`
- Follow-up action: Decide whether to stop at the current shared-helper boundary or introduce one broader accepted-entry service that owns post-handoff participant acceptance/reconnect across more activities.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Consuming a live session entry-participant token now also records an accepted-entry participant record on the session in `acceptedEntryParticipants[participantId] = { participantId, displayName, acceptedAt }`. This makes accepted entry observable on the server after the token is redeemed, not only on the client that consumed it.
- Compatibility constraints: The consume route response remains `{ values }`, and activities are not yet required to consult `acceptedEntryParticipants` during websocket join or later updates. Existing direct joins without waiting-room handoff still work unchanged.
- Validation rules: Only consumed values with a non-empty string `participantId` produce an accepted-entry record. `displayName` is normalized to a trimmed string or `null`. The accepted-entry record is session-scoped and written at token-consume time.
- Evidence (schema/tests/path): `server/core/acceptedEntryParticipants.ts`; `server/core/sessions.ts`; `server/acceptedEntryParticipants.test.ts`; `server/sessionEntryRoutes.test.ts`
- Follow-up action: Decide which activity join/reconnect paths should start consulting `acceptedEntryParticipants` first so post-handoff participant acceptance becomes more authoritative than “client sent a matching name and ID”.
- Owner: Codex

- Date: 2026-03-14
- Surface: websocket | internal module
- Contract: `java-string-practice` and `java-format-practice` websocket joins now consult `acceptedEntryParticipants` by `participantId` when the reconnecting client does not send `studentName`. A previously accepted waiting-room entry can therefore rehydrate the participant name server-side during join.
- Compatibility constraints: Explicit `studentName` from the client still wins when present. Activities that have not opted into this behavior remain unchanged. Direct joins without prior accepted entry still require the existing query-name behavior.
- Validation rules: Only a non-empty accepted-entry `displayName` for the supplied `participantId` may be used as the fallback name. Missing accepted-entry records do not create or guess a name.
- Evidence (schema/tests/path): `server/core/acceptedEntryParticipants.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `server/acceptedEntryParticipants.test.ts`
- Follow-up action: Decide whether to extend the same fallback rule to additional session-backed activities or replace it with a broader accepted-entry join service.
- Owner: Codex

- Date: 2026-03-14
- Surface: websocket | internal module
- Contract: `connectAcceptedSessionParticipant()` in `server/core/acceptedSessionParticipants.ts` is now the shared server entry-point for session-backed websocket joins that want to prefer accepted-entry identity. It resolves the effective participant name from explicit query input first, then from `acceptedEntryParticipants[participantId]`. When that `participantId` is present but not yet in the participant list, the helper now creates the first participant record with the same accepted `participantId` instead of minting a new one.
- Compatibility constraints: Activities opt into this service individually. It does not replace activity-specific participant fields or payload shapes, and it does not force activities without accepted-entry support to change behavior.
- Validation rules: A join only proceeds when the service can resolve a non-empty participant name. Explicit client-provided names still win over accepted-entry fallback when an activity passes them, but a non-empty `participantId` now stays stable on first accepted-entry create instead of being replaced. When the client reconnects with only `participantId`, the service may also reuse the already-stored participant name for that same participant record instead of requiring the browser to resend `studentName`. The downstream participant connect logic continues to own legacy unnamed matching and participant-shape-specific mutation.
- Evidence (schema/tests/path): `server/core/acceptedSessionParticipants.ts`; `server/acceptedSessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`; `activities/python-list-practice/server/studentParticipants.ts`; `activities/syncdeck/server/studentParticipants.ts`
- Follow-up action: The main remaining question is whether more activities should standardize on the same direct accepted-entry connect path instead of keeping separate pre-connect registration endpoints.
- Owner: Codex

- Date: 2026-03-14
- Surface: websocket | client entry
- Contract: SyncDeck student entry now resolves identity from either cached session storage or the accepted waiting-room handoff, then connects directly to `/ws/syncdeck`. On first connect, `connectAcceptedSessionParticipant()` preserves the waiting-room-issued `participantId` and creates the server-side student record when needed; later reconnects reuse the stored SyncDeck student record by the same ID.
- Compatibility constraints: Stored SyncDeck student identity still wins over newly consumed accepted-entry values, so reconnect behavior for previously connected students remains unchanged. When neither stored nor accepted identity exists, the client surfaces a “restart entry” state instead of an in-activity name form. The old pre-connect `register-student` route is gone.
- Validation rules: Direct student websocket entry requires both `studentId` and `studentName` from either stored or accepted identity. Missing identity no longer triggers an in-activity manual registration fallback, and first accepted-entry connect keeps the supplied `participantId` stable instead of minting a new one.
- Evidence (schema/tests/path): `server/core/acceptedSessionParticipants.ts`; `server/acceptedSessionParticipants.test.ts`; `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/server/studentParticipants.test.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/entryIdentityUtils.ts`; `activities/syncdeck/client/student/entryIdentityUtils.test.ts`
- Follow-up action: The remaining SyncDeck divergence is now mostly about activity-owned websocket payload/session shape, not student identity establishment.
- Owner: Codex

- Date: 2026-03-14
- Surface: activity config | waiting room
- Contract: SyncDeck now declares the shared waiting-room `displayName` field in `activity.config.ts`, so join-code and permalink entry can collect student identity before the activity-specific registration/connect path runs.
- Compatibility constraints: SyncDeck still does not support the generic `/solo/:activityId` route, but the config model now allows standalone capability to be expressed separately from direct solo-path support. The waiting-room field declaration is now the required student-name collection step for new entry rather than a hint layered on top of an in-activity prompt.
- Validation rules: `displayName` is required and uses the same shared text-field contract as the migrated Java activities. New SyncDeck student entry now expects that value to be collected before the activity loads.
- Evidence (schema/tests/path): `activities/syncdeck/activity.config.ts`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/SessionRouter.tsx`
- Follow-up action: If SyncDeck later removes its separate registration route, keep the waiting-room field as the single authoritative student-name collection step instead of reintroducing a second in-activity prompt.
- Owner: Codex

- Date: 2026-03-13
- Surface: REST | websocket
- Contract: Generic persistent-link creation and listing now carry `entryPolicy?: PersistentSessionEntryPolicy`. `POST /api/persistent-session/create` accepts `entryPolicy` alongside `activityName`, `teacherCode`, and optional `selectedOptions`; `GET /api/persistent-session/list` returns each saved link with normalized `entryPolicy`. Teacher-start rejection for `solo-only` uses a shared payload shape across both `POST /api/persistent-session/authenticate` and websocket `teacher-code-error`.
- Contract update: canonical permalink signing is now the shared model for persistent links. `POST /api/persistent-session/create` returns `/activity/:activity/:hash?...&entryPolicy=...&urlHash=...`, where `urlHash` signs the canonical permalink state (`entryPolicy` plus canonicalized activity `deepLinkOptions`). Generic permalink entry/auth routes and activity-owned recovery paths should trust only that canonical signed state. Teacher cookies persist the same `entryPolicy` + `urlHash` so the dashboard can reconstruct links after a restart.
- Contract update: the shared dashboard now supports permalink maintenance too. `POST /api/persistent-session/update` accepts `{ activityName, hash, selectedOptions?, entryPolicy? }` and rewrites the signed permalink state for the same hash using the remembered teacher cookie entry; `POST /api/persistent-session/remove` accepts `{ activityName, hash }` and removes that saved permalink from the teacher cookie while cleaning up current runtime metadata for the hash.
- Compatibility constraints: Missing or invalid `entryPolicy` or `urlHash` values normalize to `instructor-required`. Generic permalink read/auth routes should not rely on server metadata as the source of truth for entry mode; invalid or absent signed URL state falls back to `instructor-required` / "Live Only".
- Validation rules: Only `instructor-required`, `solo-allowed`, and `solo-only` are accepted; other values are treated as compatibility fallback to `instructor-required`. `solo-only` must not allow managed-session startup through either `POST /api/persistent-session/authenticate` or the persistent-session websocket teacher-start path. Policy rejection uses `{ error, code: 'entry-policy-rejected', entryPolicy: 'solo-only' }` in REST and as the payload body for websocket `teacher-code-error`.
- Evidence (schema/tests/path): `server/routes/persistentSessionRoutes.ts`; `server/core/persistentSessionWs.ts`; `server/core/persistentSessionPolicyUtils.ts`; `server/persistentSessionRoutes.test.ts`; `server/persistentSessionPolicyUtils.test.ts`; `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/persistentSessionAuthUtils.ts`; `client/src/components/common/waitingRoomUtils.ts`; `client/src/components/common/ManageDashboard.tsx`.
- Follow-up action: Reuse the same policy-rejection shape if standalone join-code entry or future shared entry APIs introduce additional disallowed managed-entry paths, and keep client parsing centralized in `persistentSessionAuthUtils.ts`.
- Owner: Codex

- Date: 2026-03-13
- Surface: activity interface
- Contract: Waiting-room Phase 0 shared contract is split across `ActivityConfig.waitingRoom` and shared waiting-room types. `ActivityConfig.waitingRoom.fields` accepts declarative field metadata with built-in field types `text`, `select`, and `custom`, while persistent/permalink entry policy uses `PersistentSessionEntryPolicy = 'instructor-required' | 'solo-allowed' | 'solo-only'` with compatibility default `instructor-required`.
- Compatibility constraints: Existing activities without `waitingRoom` remain unchanged. Existing persistent-session metadata that lacks `entryPolicy` must resolve to `instructor-required` in both stored metadata normalization and waiting-room status responses. Custom field `props` must stay data-only and serializable so config remains declarative.
- Validation rules: `waitingRoom.fields` must be an array; each field requires non-empty `id` and valid `type`; `select` fields require at least one option; `custom` fields require a string `component`; `custom.props` and `custom.defaultValue` must be serializable; persistent entry policy values outside the supported vocabulary normalize to `instructor-required`.
- Evidence (schema/tests/path): `types/waitingRoom.ts`; `types/activity.ts`; `types/activityConfigSchema.ts`; `server/activityConfigSchema.test.ts`; `server/core/persistentSessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`.
- Follow-up action: Phase 3 should reuse `PersistentSessionEntryPolicy` across the remaining join/session enforcement paths, and Phase 4 should carry waiting-room-collected data into downstream entry flows.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: Standalone persistent-link entry resolution is now modeled as three outputs in shared client logic: `resolvedRole` (`student | teacher`), `entryOutcome` (`wait | join-live | continue-solo | solo-unavailable`), and `presentationMode` (`render-ui | pass-through`). Default unauthenticated permalink entry resolves to student. Remembered teacher cookie or successful teacher-code auth count as instructor intent for managed-entry policies, while `solo-only` always resolves to student-role solo behavior even when instructor auth exists.
- Compatibility constraints: This resolver currently governs standalone permalink entry in the client. Embedded-role inheritance is documented as the target contract but is not yet a runtime-enforced path. Existing server rejection behavior for `solo-only` managed startup remains unchanged and authoritative.
- Validation rules: `solo-only` must never resolve to managed `join-live`; waiting state always renders UI; any required waiting-room field forces `presentationMode: render-ui`; started student live entry with no required fields may use `presentationMode: pass-through`.
- Evidence (schema/tests/path): `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/persistentSessionEntryPolicyUtils.test.ts`; `client/src/components/common/SessionRouter.tsx`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: Reuse the same role/presentation resolver shape when join-code entry is moved behind a shared server-backed waiting-room gateway, and extend it to embedded parent-role inheritance once that track is ready.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Direct session/join-code entry now has a dedicated server-backed gateway payload at `GET /api/session/:sessionId/entry`. The response shape is `{ sessionId, activityName, waitingRoomFieldCount, resolvedRole, entryOutcome, presentationMode }`, currently fixed to student `join-live` with `presentationMode` derived from whether the activity declares waiting-room fields. `SessionRouter` uses this payload before fetching full session data.
- Compatibility constraints: `GET /api/session/:sessionId` remains unchanged for activity runtime data. The new `/entry` route adds gateway metadata without changing existing session payload consumers. Join-code entry still uses a separate endpoint from persistent/permalink entry; this contract narrows the divergence but does not fully unify the surfaces yet.
- Validation rules: Missing sessions return `404 { error: 'invalid session' }` like the existing session route. Activities with waiting-room fields must resolve to `presentationMode: render-ui`; activities without fields resolve to `pass-through`.
- Evidence (schema/tests/path): `types/waitingRoom.ts`; `server/core/sessions.ts`; `server/sessionEntryRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/sessionEntryRenderUtils.ts`
- Follow-up action: Collapse permalink and join-code entry onto one shared gateway service once server-backed participant handoff/storage is designed, so both surfaces stop carrying parallel entry payloads.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Persistent/permalink entry now also has a dedicated server-backed gateway payload at `GET /api/persistent-session/:hash/entry?activityName=...`. The response shape is `{ activityName, hash, entryPolicy, hasTeacherCookie, isStarted, sessionId, waitingRoomFieldCount, resolvedRole, entryOutcome, presentationMode }`, and `SessionRouter` now trusts that server-computed decision instead of recomputing permalink role/presentation locally from raw metadata.
- Compatibility constraints: `GET /api/persistent-session/:hash` remains available for older metadata/status consumers. Permalink and join-code entry now use parallel entry-status endpoints with aligned decision vocabulary, but they are not yet a single shared backend gateway service.
- Validation rules: Missing `hash` or `activityName` returns `400`; missing sessions still normalize/reset through existing persistent-session lookup rules before the entry-status payload is returned. `solo-only` with remembered teacher cookie must still resolve to student-role solo behavior, not teacher live entry.
- Evidence (schema/tests/path): `types/waitingRoom.ts`; `server/core/persistentSessionEntryStatus.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`
- Follow-up action: When the entry surfaces are finally unified, replace the parallel session/persistent entry endpoints with one shared gateway abstraction instead of letting both grow independently.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: Server-side entry-status payload assembly is now centralized in `server/core/entryStatus.ts`. Direct-session and persistent-session routes still expose different REST endpoints and source data, but they now derive `resolvedRole`, `entryOutcome`, and `presentationMode` through the same backend builder logic instead of maintaining parallel payload assembly rules in each route file.
- Compatibility constraints: Endpoint URLs and top-level payload shapes remain unchanged for this refactor. The shared builder reduces duplication but does not yet merge the underlying session lookup and persistent-link lookup pathways.
- Validation rules: Presentation mode must remain derived from `waitingRoomFieldCount` plus `entryOutcome`; direct session entry stays fixed to student `join-live`; persistent entry preserves `solo-only`, teacher-cookie, and solo-support rules.
- Evidence (schema/tests/path): `server/core/entryStatus.ts`; `server/core/sessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/sessionEntryRoutes.test.ts`; `server/persistentSessionRoutes.test.ts`
- Follow-up action: Use this shared builder as the seam for a later unified gateway service instead of reintroducing route-local entry decision logic.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Waiting-room carry-forward now supports two server-backed opaque-token handoff paths. `POST /api/session/:sessionId/entry-participant` / `POST /api/session/:sessionId/entry-participant/consume` cover live-session entry, and `POST /api/persistent-session/:hash/entry-participant?activityName=...` / `POST /api/persistent-session/:hash/entry-participant/consume?activityName=...` cover persistent permalink solo continuation. Consume calls send `{ token }` in the JSON body. Both paths accept `{ values }`, normalize serializable waiting-room fields, temporarily store them behind an opaque token, and return `{ entryParticipantToken, values }` on store plus `{ values }` on one-shot consume.
- Compatibility constraints: Client sessionStorage still holds the handoff token and remains the fallback when server-backed storage fails. Existing activity websocket payloads and runtime `studentId` / `participantId` fields are unchanged; the token path is additive.
- Validation rules: Missing or mismatched sessions return `404 { error: 'invalid session' }` or `404 { error: 'invalid persistent session' }`; missing or already-consumed tokens return `404 { error: 'entry participant not found' }`; non-serializable values are dropped during normalization before storage; successful consume removes the stored token entry. Server-backed storage guarantees a non-empty `participantId` string in the stored/returned values, minting one with the shared participant ID helper when the waiting-room payload did not already include one.
- Evidence (schema/tests/path): `server/core/sessionEntryParticipants.ts`; `server/core/sessions.ts`; `server/core/persistentSessions.ts`; `server/sessionEntryRoutes.test.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/WaitingRoom.tsx`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Extend this contract beyond `displayName` and temporary handoff only when shared participant identity and reconnect ownership are finalized, so we do not ossify an incomplete participant schema too early.
- Owner: Codex

- Date: 2026-03-14
- Surface: client | REST | websocket
- Contract: Waiting-room ownership is now split intentionally. Client-side waiting-room code owns declarative field rendering, required-field validation, wait-state form persistence, token persistence, and fallback local-value storage. Server-side entry routes own temporary handoff storage for live-session entry and persistent-session solo continuation, opaque token issuance/consume, and early shared `participantId` issuance. Activity routes/websockets still own activity-specific acceptance, reconnect matching, and progress semantics after entry is handed off.
- Compatibility constraints: This is an implementation contract, not yet a fully unified participant service. Activities that have not adopted waiting-room handoff continue to behave as before, and solo `/:activityId` entry remains a separate compatibility path outside the persistent permalink handoff routes.
- Validation rules: Client must not treat waiting-room form completion as equivalent to accepted activity registration; only server-issued handoff plus later activity join/startup acceptance are authoritative. Server handoff routes must not assume activity-specific participant schemas beyond serializable waiting-room values plus shared `participantId`.
- Evidence (schema/tests/path): `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomFormUtils.ts`; `client/src/components/common/entryParticipantStorage.ts`; `server/core/sessions.ts`; `server/core/sessionEntryParticipants.ts`; `server/core/persistentSessions.ts`; `server/persistentSessionRoutes.test.ts`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: The biggest remaining contract work is defining what happens after handoff: which server surface accepts a waiting-room-issued `participantId`, how reconnect is proven across activities, and whether the shared entry layer itself should become the authoritative place that persists reusable session-scoped reconnect identity instead of each activity writing its own `student-name-*` / `student-id-*` keys.
- Owner: Codex

- Date: 2026-03-14
- Surface: client | internal module
- Contract: Session-scoped reconnect identity now has a shared client storage shape in `sessionParticipantContext.ts`, keyed by `session-participant:${sessionId}`. Shared entry helpers and migrated activities may persist `{ studentName, studentId }` there, and entry resolution prefers that shared context before falling back to legacy `student-name-*` / `student-id-*` keys.
- Compatibility constraints: Legacy per-key storage remains readable and is still written by some compatibility paths while migration is incomplete. Activities that have not adopted the shared context helper may continue to rely on the older keys for now.
- Validation rules: Stored values are trimmed string-or-null fields; invalid or empty payloads are removed. The shared context may contain `studentId` without `studentName`, but when both exist they must describe the same session-scoped participant.
- Evidence (schema/tests/path): `client/src/components/common/sessionParticipantContext.ts`; `client/src/components/common/sessionParticipantContext.test.ts`; `client/src/components/common/entryParticipantIdentityUtils.ts`; `client/src/components/common/entryParticipantIdentityUtils.test.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Move the authoritative writes for this context closer to shared entry acceptance so activities do not need to decide when to persist reconnect identity themselves.
- Owner: Codex

- Date: 2026-02-23
- Surface: REST
- Contract: SyncDeck permalink creation/edit now participates in the shared canonical permalink signing flow. The activity-owned builder still performs SyncDeck-specific presentation validation and may call `POST /api/syncdeck/generate-url` for create-mode UX, but the durable permalink contract is the canonical persistent-link URL shape `/activity/:activity/:hash?...&entryPolicy=...&urlHash=...`, where `urlHash` signs `entryPolicy` plus canonicalized activity `deepLinkOptions`.
- Compatibility constraints: Activities without custom builders/generators continue using shared `/api/persistent-session/create` and `/api/persistent-session/update`. SyncDeck-specific manage recovery must use server/cookie-backed canonical permalink state instead of trusting raw manage-route query params after redirects.
- Validation rules: `activityName` must match `syncdeck`; `teacherCode` follows existing persistent-session constraints; `selectedOptions.presentationUrl` must be a valid `http`/`https` URL before URL generation.
- Evidence (schema/tests/path): `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `server/routes/persistentSessionRoutes.ts`; `.agent/plans/complete/permalink-signing-plan.md`.
- Follow-up action: Continue aligning other permalink-capable activities with the same canonical launch/recovery expectations, especially where activity-owned recovery still needs to consume signed state after redirects.
- Owner: Codex

- Date: 2026-02-23
- Surface: activity interface
- Contract: `ActivityConfig.deepLinkOptions` supports structured option metadata: `{ label?: string; type?: 'select' | 'text'; options?: Array<{ value: string; label: string }>; validator?: 'url' }`.
- Compatibility constraints: `validator` is optional and defaults to no validation. Existing activities with legacy option objects remain compatible because parser fallback treats unrecognized values as no validator.
- Validation rules: For `validator: 'url'`, dashboard treats the field as required and enforces valid `http(s)` URL syntax before persistent-link create and solo copy/open actions.
- Evidence (schema/tests/path): `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `client/src/components/common/ManageDashboard.tsx`.
- Follow-up action: If additional validators are introduced, centralize them in `manageDashboardUtils` to keep parser + UI behavior consistent across modals.
- Owner: Codex

- Date: 2026-02-24
- Surface: activity interface
- Contract: `ActivityConfig.manageDashboard.customPersistentLinkBuilder?: boolean` advertises that the activity provides an activity-owned persistent-link modal UI via client-module export `PersistentLinkBuilderComponent`, and shared `ManageDashboard` should render that component instead of the generic `deepLinkOptions` form.
- Compatibility constraints: Flag is optional and defaults to `false`; activities without the flag or without a component continue to use the generic dashboard permanent-link flow. Shared dashboard placement and success-state behavior remain standardized.
- Validation rules: Runtime `activity.config` schema validates `manageDashboard.customPersistentLinkBuilder` as boolean when present. Client module component must implement the shared-submit props (`activityId`, `teacherCode`, string `selectedOptions`, `onSelectedOptionsChange(...)`, `onSubmitReadinessChange(...)`) so dashboard can keep final permalink creation centralized.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/activities/index.ts`; `client/src/components/common/ManageDashboard.tsx`; `client/src/components/common/manageDashboardViewUtils.ts`; `client/src/components/common/ManageDashboard.test.tsx`; `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`.
- Follow-up action: Expand `ActivityPersistentLinkBuilderProps` only when multiple activities need additional shared callbacks or state; avoid pushing activity-specific protocol/UI details back into shared dashboard code.
- Owner: Codex

- Date: 2026-02-23
- Surface: REST
- Contract: `POST /api/syncdeck/:sessionId/configure` now requires `presentationUrl` to be a valid `http(s)` URL in addition to passcode checks; invalid URL shape returns `{ error: 'invalid payload' }` with `400`.
- Compatibility constraints: Response shape remains unchanged (`{ ok: true }` on success), and existing passcode/urlHash flows continue to work when URL is valid.
- Validation rules: Reject missing or non-http(s) `presentationUrl`, reject bad passcode, reject client-provided `persistentHash`, and reject invalid/missing mapping for `urlHash` verification paths.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts` (configure invalid URL, tampered hash, mapping missing).
- Follow-up action: Keep configure validation policy synchronized with generate-url endpoint validation to avoid drift.
- Owner: Codex

- Date: 2026-02-23
- Surface: websocket
- Contract: SyncDeck websocket relay uses activity channel `syncdeck-state-update` (instructor -> server) and `syncdeck-state` (server -> students). The relayed payload is a Reveal plugin envelope and student client translates `action: 'state'` into host command envelope (`action: 'command'`, `payload.name: 'setState'`) before posting to iframe.
- Compatibility constraints: Server message wrapper keys (`type`, `payload`) must remain stable for manager/student clients; plugin-level envelope fields should remain aligned with `.agent/plans/reveal-iframe-sync-message-schema.md`.
- Validation rules: Instructor websocket requires `role=instructor` plus matching `instructorPasscode`; students connect by `sessionId` only. Invalid/unknown ws messages are ignored.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts` (snapshot + relay tests); `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `.agent/plans/reveal-iframe-sync-message-schema.md`.
- Follow-up action: Add dedicated student-side unit tests for `state` -> `command.setState` translation when adding more plugin command support.
- Owner: Codex

- Date: 2026-03-20
- Surface: REST + websocket + activity interface
- Contract: Resonance REST endpoints — `POST /api/resonance/create` → `{ id, instructorPasscode }`; `POST /api/resonance/:sessionId/register-student` body `{ name }` → `{ studentId, name }`; `POST /api/resonance/prepare-link-options` body `{ teacherCode, questions: Question[] }` → `{ selectedOptions: { q, h } }`; `GET /api/resonance/:sessionId/state` → student-safe snapshot (no isCorrect, no response data); `GET /api/resonance/:sessionId/responses` (instructor auth) → responses + annotations; `GET /api/resonance/:sessionId/instructor-passcode` (teacher cookie) → `{ instructorPasscode }`; `GET /api/resonance/:sessionId/report` (instructor auth) → HTML or JSON export.
- Compatibility constraints: `isCorrect` must never appear in student-facing payloads before a reveal; instructor passcode is never included in student snapshots; annotations (star/flag) are instructor-private and excluded from shared-response payloads.
- Validation rules: Questions validated by `activities/resonance/shared/validation.ts`; student name trimmed, max 80 chars; answer payload type must match active question type; selectedOptionId must be a valid option id on the target question; permalink preparation must return string-valued `selectedOptions` for the shared persistent-link pipeline.
- Evidence (schema/tests/path): `activities/resonance/shared/types.ts`; `activities/resonance/shared/validation.ts`; `activities/resonance/server/routes.ts`.
- Follow-up action: Add route tests for each endpoint in Phase 9; add WebSocket message contract entry when Phase 7 is implemented.
- Owner: Codex

- Date: 2026-03-21
- Surface: REST | activity interface
- Contract: Resonance permalink preparation now uses `POST /api/resonance/prepare-link-options` body `{ teacherCode, questions: Question[] }` → `{ selectedOptions: { q, h } }`, where `q` is the encrypted question payload and `h` is the activity-specific decryption hash. This endpoint prepares activity data only; it does not create or update the platform persistent session.
- Compatibility constraints: `q`/`h` are internal deep-link options consumed by Resonance create/update flows via shared `ManageDashboard`. The platform persistent-link hash remains separate and continues to be minted by `/api/persistent-session/create|update`. Resonance question-edit recovery may use local draft cache keyed by `h`, but permalink storage itself still carries only string `selectedOptions`.
- Validation rules: `teacherCode` must be 6-100 chars after trimming; `questions` must pass `validateQuestionSet(...)`; oversized encrypted payloads must fail with `422` when they exceed `MAX_ENCODED_PAYLOAD_CHARS`.
- Evidence (schema/tests/path): `activities/resonance/server/routes.ts`; `activities/resonance/server/routes.test.ts`; `activities/resonance/client/tools/ResonancePersistentLinkBuilder.tsx`
- Follow-up action: Keep any future Resonance permalink metadata additive and string-valued so it can continue flowing through the shared persistent-link pipeline without special casing.
- Owner: Codex

- Date: 2026-03-20
- Surface: activity interface
- Contract: `ActivityConfig.utilMode?: boolean` advertises that the activity exposes a utility/tools page at `/util/:activityId`, rendered from the client module's `UtilComponent` export. `ActivityClientModule.UtilComponent` is only loaded by the registry when `utilMode: true`.
- Compatibility constraints: Flag is optional and defaults to undefined/false; existing activities without the flag are unaffected. Route `/util/:activityId` is registered in App.tsx only for activities that have `UtilComponent`.
- Validation rules: Schema validates `utilMode` as boolean when provided.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/activities/index.ts`; `client/src/App.tsx`; `activities/resonance/activity.config.ts`.
- Follow-up action: If a second activity adopts `utilMode`, document any shared navigation or shell conventions needed in this contract.
- Owner: Codex

- Date: 2026-03-20
- Surface: websocket
- Contract: Resonance WebSocket envelope — `{ version: '1', activity: 'resonance', sessionId: string, type: string, timestamp: number, payload: unknown }`. All message types use a `resonance:` prefix (e.g. `resonance:question-activated`). Instructor connects with `role=instructor&instructorPasscode=<code>`. Student connects with `studentId=<id>`.
- Compatibility constraints: Envelope `version` field must be checked before processing; unknown types must be silently ignored on client; never include `isCorrect` or `instructorPasscode` in student-bound payloads.
- Validation rules: Server closes socket with code 1008 on missing sessionId, unknown session, or invalid instructor passcode.
- Evidence (schema/tests/path): `activities/resonance/shared/types.ts` (ResonanceWsEnvelope); `activities/resonance/server/routes.ts`.
- Follow-up action: Flesh out full message dispatch and add WS tests in Phase 7.
- Owner: Codex

- Date: 2026-03-02
- Surface: internal module
- Contract: SyncDeck reveal-sync protocol version is centralized in `activities/syncdeck/shared/revealSyncProtocol.ts` and must be reused by manager, student, server, and preflight handshake code.
- Compatibility constraints: Host-generated reveal-sync envelopes should stay on the same protocol version across runtime relay and preflight ping flows so decks that validate protocol compatibility do not accept one surface and reject another.
- Validation rules: Preflight ping, manager-issued commands, student-issued host commands, and server-generated reveal-sync payloads all import the shared `REVEAL_SYNC_PROTOCOL_VERSION`.
- Evidence (schema/tests/path): `activities/syncdeck/shared/revealSyncProtocol.ts`; `activities/syncdeck/client/shared/presentationPreflight.ts`; `activities/syncdeck/client/shared/presentationPreflight.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: If the reveal-sync schema version changes again, update the shared module once and keep compatibility tests around preflight/startup handshakes.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | websocket
- Contract: SyncDeck student identity is server-issued. `POST /api/syncdeck/:sessionId/register-student` is the authoritative source of `studentId`, and `/ws/syncdeck` student connects must present a previously registered `studentId`. Missing or unknown IDs are rejected with websocket close code `1008` and reason `missing studentId` or `unregistered student`.
- Compatibility constraints: SyncDeck still uses its own REST registration flow rather than the shared waiting-room accepted-entry service. The client may cache `studentId` in `sessionStorage`, but cached values are only valid if they still match a registered student record for that session.
- Validation rules: Server must not create a new SyncDeck student record from websocket query params alone. The client should clear stale cached registration and prompt for re-entry when websocket connect fails for missing or unknown student identity.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/server/studentParticipants.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep this contract in place unless/until SyncDeck is moved onto a broader shared accepted-entry service that can authoritatively issue and validate participant context across presentation-linked flows.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST
- Contract: SyncDeck now exposes `POST /api/syncdeck/:sessionId/embedded-context` as a parent-context proof surface for future embedded launches. A valid `instructorPasscode` resolves `{ resolvedRole: 'teacher' }`; a valid registered `studentId` resolves `{ resolvedRole: 'student', studentId, studentName }`; unknown identity resolves `403 { error: 'forbidden' }`.
- Compatibility constraints: This does not launch embedded activities yet and does not replace waiting-room entry. It is a narrow validation surface meant to prove inherited parent role from an existing SyncDeck session without prompting for teacher code again in the eventual child flow.
- Validation rules: Missing or invalid `sessionId` follows existing SyncDeck route patterns (`400` / `404`). Student inheritance must only succeed for an already registered SyncDeck student record. Teacher inheritance must only succeed for a valid instructor passcode for that session.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Wire the eventual embedded child-launch path to this validated parent context instead of re-deriving teacher/student role from client claims alone. The client-side fetch/request-resolution contract now lives in `activities/syncdeck/client/shared/embeddedContextUtils.ts`.
- Owner: Codex
- Date: 2026-07-11
- Surface: browser route | SyncDeck static presentation launch
- Contract: SyncDeck static presentation hosting should use the same-origin utility route `/util/syncdeck/launch-presentation?presentationUrl=<absolute-url>` rather than browser-side cross-origin calls to `/api/syncdeck/*`. The presentation supplies `presentationUrl` or the alias `presentation-url`; ActiveBits runs SyncDeck preflight, creates/configures a temporary SyncDeck session on its own origin, and redirects to `/:sessionId` by default so the deck opens in solo student mode. Adding `mode=instructor` creates/configures a hosted instructor session, hands the generated instructor passcode to the manager through same-tab router state, and redirects to `/manage/syncdeck/:sessionId?presentationUrl=...`.
- Compatibility constraints: `presentationUrl` must remain a public absolute `http(s)` URL that passes SyncDeck Reveal preflight from the ActiveBits origin. `mode=instructor` is for immediate temporary sessions only; permanent links continue to use `/api/syncdeck/generate-url` and signed persistent-link state. Hidden utility routes may be declared in `activity.config.*` with a `utilities[]` entry that omits `surfaces` so it is routable but not shown on `/manage` or `/`.
- Validation rules: Invalid or preflight-failing presentation URLs must stop before session creation. Unknown `mode` values fall back to the standalone student launch behavior.
- Evidence (schema/tests/path): `activities/syncdeck/client/util/SyncDeckLaunchPresentation.tsx`; `activities/syncdeck/client/util/SyncDeckLaunchPresentation.test.tsx`; `skills/syncdeck/SKILL.md`; `skills/syncdeck/references/IFRAME_SYNC_PROTOCOL.md`
- Follow-up action: If the bundled deck runtime gains a first-class option for instructor-mode CTA links, document that runtime option here and in the SyncDeck skill alongside the URL contract.
- Owner: Codex

- Date: 2026-07-11
- Surface: browser route | SyncDeck permalink builder
- Contract: `/util/syncdeck/permalink?presentationUrl=<absolute-url>` renders an ActiveBits-hosted permalink builder page with the presentation URL prefilled. The GET route must not create a persistent link by itself; link creation still requires browser-side Reveal preflight plus a teacher code and then posts to `POST /api/syncdeck/generate-url`.
- Compatibility constraints: Keep `presentationUrl` as the canonical generated query parameter and accept `presentation-url` as an alias for manually authored links. The builder is a UI flow for externally hosted decks that cannot call ActiveBits APIs cross-origin; it should preserve the same server-side signing and cookie behavior as dashboard-created SyncDeck permalinks by using the existing generator endpoint.
- Validation rules: Invalid or preflight-failing presentation URLs must stop before `POST /api/syncdeck/generate-url`. Teacher-code validation remains server-owned by the generator endpoint.
- Evidence (schema/tests/path): `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/util/SyncDeckLaunchPresentation.tsx`; `activities/syncdeck/client/util/SyncDeckLaunchPresentation.test.tsx`; `activities/syncdeck/server/routes.ts`
- Follow-up action: If the dashboard and utility permalink builders drift visually or behaviorally, extract a shared SyncDeck permalink-builder component rather than forking validation semantics.
- Owner: Codex
- Date: 2026-03-24
- Surface: Resonance student snapshot
- Contract: `StudentSessionSnapshot` now includes `selfPacedMode: boolean`. For Resonance launched from a standalone SyncDeck parent, this flag reflects the effective fallback mode, not just session origin: it is `true` only while no instructor-activated run is active. In that mode, `activeQuestions`/`activeQuestionIds` fall back to the full question set, and once the viewer has submitted every question the snapshot synthesizes MCQ reveal entries with `correctOptionIds` and `viewerResponse` even though no instructor explicitly shared results.
- Compatibility constraints: Live teacher-led Resonance sessions keep the previous semantics: only `activeQuestionIds` are askable, and MCQ correctness is still hidden until the instructor shares results. Self-paced reveals do not include shared-response percentages or peer data.

- Date: 2026-04-20
- Surface: persistent-session websocket | activity config
- Contract: Activity configs can declare `createSessionBootstrap.selectedOptionsToSessionData` to copy specific persistent-link `selectedOptions` keys onto top-level live `session.data` when a teacher starts a persistent session from the waiting-room websocket. SyncDeck opts in for `presentationUrl` so live manager/student flows recover the authoritative deck URL from session state.
- Compatibility constraints: The full selected-options payload remains available under `session.data.embeddedLaunch.selectedOptions`; only declared keys are duplicated at top level to avoid copying large payloads such as Resonance `q`. URL-validated deep-link options are normalized from encoded strings before top-level hydration.
- Validation rules: Schema accepts only non-empty string keys in `selectedOptionsToSessionData`; server tests cover SyncDeck `presentationUrl` hydration and encoded URL normalization.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `activities/syncdeck/activity.config.ts`; `server/core/persistentSessionWs.ts`; `server/persistentSessionWs.test.ts`
- Follow-up action: If another activity needs top-level live session bootstrap from permalink options, opt in through config rather than broad-copying every selected option.
- Owner: Codex

- Date: 2026-04-20
- Surface: persistent-session websocket | waiting room
- Contract: Persistent-session `teacher-authenticated` websocket messages may include `createSessionPayload` containing fields from an activity's `createSessionBootstrap` contract. The waiting room persists that payload before navigating to `/manage/:activityId/:sessionId`, matching dashboard-created session bootstrap behavior.
- Compatibility constraints: The payload is limited to fields declared by the activity's `createSessionBootstrap.historyState` or non-sensitive `sessionStorage[].responseField` entries. For SyncDeck this carries `instructorPasscode` through same-tab router state only so the manager can authenticate `/ws/syncdeck` even when cookie-based passcode recovery fails.
- Validation rules: Waiting-room message parsing accepts only object-shaped `createSessionPayload`; client socket tests assert the payload is surfaced before navigation, and server websocket tests assert SyncDeck emits the configured bootstrap payload.
- Evidence (schema/tests/path): `server/core/persistentSessionWs.ts`; `server/persistentSessionWs.test.ts`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomSocketUtils.ts`; `client/src/components/common/waitingRoomSocketUtils.test.ts`; `client/src/components/common/waitingRoomUtils.ts`
- Follow-up action: If future activities rely on persistent-session websocket starts for manager credentials, add the needed response fields to their `createSessionBootstrap` config rather than adding activity-specific waiting-room code.
- Owner: Codex

- Date: 2026-07-10
- Surface: SyncDeck embedded activities | Postboard session normalization
- Contract: Postboard embedded launches use the same selected-option keys as Postboard permalinks: `prompt` and `autoApprove`. SyncDeck stores those values under the child session's `embeddedLaunch.selectedOptions`; the Postboard normalizer preserves the embedded envelope and hydrates live `session.data.prompt.text`, `session.data.settings.autoApprove`, and a generated `instructorPasscode`.
- Compatibility constraints: Deck-authored `activityOptions` remain launch metadata under `embeddedLaunch.selectedOptions`, while live prompt/settings fields become authoritative session state after normalization. Future Postboard embedded fields should use `activity.config.ts` deep-link options and normalizer hydration rather than SyncDeck-specific routes.
- Validation rules: SyncDeck server tests assert embedded child creation for `postboard` stores the selected options, location, manager bootstrap passcode, parent embedded activity map entry, and normalized Postboard prompt/settings state.
- Evidence (schema/tests/path): `activities/postboard/activity.config.ts`; `activities/postboard/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`
- Follow-up action: If Postboard adds more launch options, keep `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` and `activity.config.ts` aligned with the normalizer.
- Owner: Codex

- Date: 2026-04-20
- Surface: SyncDeck embedded activities
- Contract: Embedded activity starts carry a generated `instanceKey` and, when anchored to a Reveal slide, an explicit `location: { h, v }`. New deck-driven launches derive both values from the actual instructor/deck indices at load/request time; presentation-authored `instanceKey` values are not trusted when position context is available.
- Compatibility constraints: Existing records without `location` still fall back to parsing legacy `activityId:h:v` keys. New parent records, child `embeddedLaunch` payloads, start responses, and `embedded-activity-start` websocket payloads preserve `location` so student/manager activation can use the stored location instead of reparsing fragile IDs.
- Validation rules: Client grouping tests assert generated position keys include `location`; shared identity tests reject fractional coordinates; server route tests assert start persists and broadcasts `location` and rejects explicit locations that are malformed or inconsistent with the generated `instanceKey`.
- Evidence (schema/tests/path): `activities/syncdeck/shared/embeddedActivityIdentity.ts`; `activities/syncdeck/client/shared/groupedActivityRequests.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Keep future SyncDeck embedded activation logic keyed by explicit location first, with instance-key parsing only for legacy records.
- Owner: Codex

- Date: 2026-04-20
- Surface: SyncDeck websocket | embedded activities
- Contract: `/ws/syncdeck` replays existing `session.data.embeddedActivities` as `syncdeck-state` payloads with `type: "embedded-activity-start"` when an instructor or student connection is accepted. Student replays include a freshly stored child-session `entryParticipantToken`; instructor replays use `entryParticipantToken: null`.
- Compatibility constraints: This supplements the live broadcast from `POST /api/syncdeck/:sessionId/embedded-activity/start` so clients that load or reconnect after a background prestart can still activate the embedded overlay once they receive the instructor slide state. Stale embedded records whose child session is missing are skipped rather than recreated on websocket bootstrap.
- Validation rules: Server websocket tests assert replay ordering before slide-state snapshots and token persistence for students.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Keep embedded activity state replayed from parent session state whenever adding new SyncDeck client activation paths, so activation does not depend on clients being online during the original start broadcast.
- Owner: Codex

- Date: 2026-04-20
- Surface: Teacher Join | create-session bootstrap
- Contract: `POST /api/session/:sessionId/teacher-authenticate` may include `createSessionPayload` for fields declared by the activity's `createSessionBootstrap` contract, mirroring persistent waiting-room `teacher-authenticated` websocket behavior. The home-page Teacher Join flow persists that payload before navigating to `/manage/:activityId/:sessionId`.
- Compatibility constraints: For SyncDeck, this carries `instructorPasscode` through same-tab router state so a second instructor joining from the ActiveBits home page can authenticate `/ws/syncdeck` without relying on cookie-based passcode recovery. Payload contents are limited to declared `createSessionBootstrap.historyState` or non-sensitive `sessionStorage[].responseField` fields.
- Validation rules: Server route tests assert Teacher Join returns the SyncDeck instructor passcode bootstrap payload; client router utility tests reject non-object payload shapes.
- Evidence (schema/tests/path): `server/core/createSessionBootstrapPayload.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/sessionRouterUtils.test.ts`
- Follow-up action: Keep Teacher Join and waiting-room teacher authentication bootstrap behavior aligned when future activities add manager credentials to `createSessionBootstrap`.
- Owner: Codex

- Date: 2026-04-20
- Surface: Standalone activity launcher
- Contract: `/launch/:activityId` is a client-rendered instructor launcher for normal temporary sessions. Loading the route is non-mutating; the client creates a session with `POST /api/:activityId/create` only after a manual button click or explicit `?start=1`, then redirects to `/manage/:activityId/:sessionId`.
- Compatibility constraints: Launcher query params are filtered through the activity's `deepLinkOptions`; unknown params and the control param `start` do not affect runtime behavior. Valid selected options are preserved on the manager URL so activities with existing query bootstrap support, such as Video Sync `sourceUrl`, can reuse the same manager path. The launcher uses the shared create-session bootstrap persistence helpers so activities that declare `createSessionBootstrap` receive the same immediate manager credentials as `/manage`.
- Validation rules: Client utility tests cover `start=1`, query filtering, URL validation, manager-path building, and create-response validation. Component tests cover auto-start, manual start, invalid launch options, navigation state, and manager query preservation.
- Evidence (schema/tests/path): `client/src/components/common/ActivityLauncher.tsx`; `client/src/components/common/activityLauncherUtils.ts`; `client/src/components/common/ActivityLauncher.test.tsx`; `client/src/components/common/activityLauncherUtils.test.ts`; `client/src/App.tsx`
- Follow-up action: If future activities need server-side launch option hydration beyond manager query params, add an explicit activity-owned contract instead of copying arbitrary launcher query params into session data.
- Owner: Codex

## MobCode live student-code contract

- Date: 2026-07-25
- Surface: MobCode live collaboration
- Contract: `MobCodeSessionData.studentCode` keeps activity-local collaboration state: `tryItEnabled`, `shareChangesEnabled`, starter and last-published instructor snapshots, participant-keyed private workspaces, and one anonymous shared example. The instructor workspace remains `groups.default`. Student snapshots contain only the published instructor code, the requesting participant's workspace, and the anonymous shared example; manager snapshots include named student workspaces only after manager-passcode authorization.
- Compatibility constraints: The shared-workspace route mutates only `studentCode.sharedExample.workspace`; manager file operations must use it when the shared tab is active. Student workspace create, save, and reset signals are manager-only refresh events and never carry peer workspace content. Retain at most 30 workspaces, 512 KiB each, and 20 MiB total.
- Validation rules: Resolve student workspaces from the accepted participant record, publish instructor state only when sharing is enabled, and never expose the complete `studentWorkspaces` map to a student endpoint.
- Evidence (schema/tests/path): `activities/mobcode/shared/types.ts`; `activities/mobcode/server/routes.ts`; `activities/mobcode/server/routes.test.ts`; `activities/mobcode/client/manager/MobCodeManager.tsx`; `activities/mobcode/client/student/MobCodeStudent.tsx`
- Follow-up action: Keep any new student-visible payload derived from the published instructor version and participant-scoped workspace snapshot.
- Owner: Codex

## Learn SyncDeck identity-fingerprint cross-system correlation contract

- Date: 2026-08-07
- Surface: internal module | Learn SyncDeck integration logging
- Contract: ActiveBits' only session identity is `mappingId = HMAC-SHA256(sharedSecret, "syncdeck\n<provider>\n<resourceLinkId>")` (`mappingId()` in `activities/syncdeck/server/learnIntegration.ts`) — there is no `context_id` or "slot" concept on the ActiveBits side; any such composition happens upstream, in whatever `provider`/`resourceLinkId` Learn sends per request. To let Learn and ActiveBits correlate requests without either side logging raw identity values, ActiveBits computes three **non-reversible** log fingerprints using the same shared HMAC secret used for Learn request signing: `providerFingerprint = HMAC-SHA256(sharedSecret, "learn-provider|" + provider).hex.slice(0,16)`, `resourceLinkFingerprint = HMAC-SHA256(sharedSecret, "learn-resource-link|" + resourceLinkId).hex.slice(0,16)`, `mappingFingerprint = HMAC-SHA256(sharedSecret, "learn-mapping|" + mappingId).hex.slice(0,16)` (see `identityFingerprint`/`identityFingerprints` in `learnIntegration.ts`; the HMAC input is `parts.join('|')` over `[domainTag, value]`). A `sessionFingerprint` for the internal SyncDeck session id uses the domain tag `"learn-session"` the same way. Learn must use the identical domain-separation strings, `|`-joined two-part HMAC input, secret, and 16-hex-char truncation to produce fingerprints that match ActiveBits' logs byte-for-byte for the same underlying value.
- Compatibility constraints: These are log-correlation identifiers only, never returned in any API response and never used for authorization or session lookup (`mappingId` remains the actual lookup key). Changing the domain-separation tags, the join character (`|`), the HMAC algorithm, or the truncation length breaks correlation with Learn's matching implementation and with historical logs — treat this as a cross-system contract, not an internal implementation detail, and coordinate any change with the Learn team.
- Validation rules: `status`, `student-entry`, `start`, and `stop` each emit a `learn-identity-resolved` log line (or, for the in-flight `start` retry case, a schema-compatible `learn-instructor-session-start-pending` line) with `operation`, `state`, `reused` (where applicable), the three identity fingerprints, and `sessionFingerprint`. Pending starts always emit `operation: "start"`, `reused: false`, and `sessionFingerprint: null`. None of these lines include raw `provider`, `resourceLinkId`, the internal mapping id, internal session ids, handoff/launch URLs, or browser tokens.
- Evidence (schema/tests/path): `activities/syncdeck/server/learnIntegration.ts`; `activities/syncdeck/server/learnIntegration.test.ts`; `.agent/knowledge/security-notes.md` (2026-08-07 entry).
- Follow-up action: Once Learn ships its matching fingerprint implementation, verify a sample of correlated `provider`/`resourceLinkId` values produce identical fingerprints across both systems' logs before relying on this for incident tracing.
- Owner: Codex

## Learn SyncDeck iframe waiting-room handoff

- Date: 2026-08-09
- Surface: Learn student waiting-room browser handoff
- Contract: The one-time Learn `waitingLaunchUrl` is consumed in the student's browser and establishes a 10-minute httpOnly `learn_syncdeck_wait` cookie. In production it uses `Secure; SameSite=None; Partitioned` so an LMS-hosted ActiveBits iframe can send the handoff cookie on its same-origin `/wait/status` poll and receive the active student-session URL without a global third-party cookie.
- Compatibility constraints: Production requires HTTPS. Development retains `SameSite=Lax` without `Secure` or `Partitioned` for local HTTP test environments.
- Validation rules: The server integration test consumes the one-time URL, asserts production cookie attributes, and verifies that the cookie resolves an active mapping. The existing Playwright waiting-room test verifies the browser transitions to an active student-session URL after a successful status poll. Validate third-party-cookie behavior in a real LMS cross-site iframe before relying on the production integration.
- Owner: Codex

## Generic session-store `linkedSessionId` keepalive contract

- Date: 2026-08-08
- Surface: internal module | `server/core/sessions.ts` (`SessionStore.touch`)
- Contract: Any session record may declare `data.linkedSessionId: string` pointing at another record in the same store. `SessionStore.touch(id)` — for both `InMemorySessionStore` and the Valkey-wrapped store returned by `createSessionStore()` — checks the touched record's `data.linkedSessionId` and, when present and not self-referential, directly refreshes that linked record without inspecting its own link (single hop, not recursive/multi-hop; mirrors the existing `embeddedParentSessionId` propagation already used by `get`/`consumeSessionDataToken`/`refreshSessionExpiry`, but that field is intentionally kept separate and is not itself propagated by `touch`). Any activity-agnostic caller that already touches session A on real activity (e.g. `server/core/wsRouter.ts`'s 30s websocket ping/pong/message loop, which calls `sessions.touch(ws.sessionId)`) will therefore also keep session B alive for as long as A has a connected client, with no changes needed to `wsRouter.ts` or to whatever drives A's own touches.
- Compatibility constraints: This is a generic store-level primitive, not owned by any one activity — the field name and propagation behavior must stay activity-agnostic per the Activity Containment Policy. First consumer: `activities/syncdeck/server/learnIntegration.ts` stamps `data.linkedSessionId` on a live SyncDeck session (`type: 'syncdeck'`) with its Learn entry-mapping id (`type: 'syncdeck-learn-entry'`) via `linkLiveSessionToEntry()`, so the entry's lifetime tracks the session's actual connectivity instead of depending solely on Learn re-polling `status`/`start`. Any future activity needing "this record should stay alive exactly as long as that other record has real activity" should reuse this field rather than adding a new one.
- Validation rules: `touch()` only propagates one hop and only when `linkedSessionId !== id`; the direct-refresh helper never follows the linked record's own link, so chains stop after one hop and two-record cycles complete safely. Only `touch()` propagates `linkedSessionId` — `get()`/`refreshSessionExpiry()`/`consumeSessionDataToken()` do not, since reading a session (as opposed to genuine touch/keepalive activity) is not the right signal for "keep the linked record alive."
- Evidence (schema/tests/path): `server/core/sessions.ts` (`getLinkedSessionId`, `InMemorySessionStore.touch`, the Valkey-wrapped `touch` closure); `server/sessionStore.test.ts`; `activities/syncdeck/server/learnIntegration.ts` (`linkLiveSessionToEntry`); `activities/syncdeck/server/learnIntegration.test.ts`; `.agent/knowledge/security-notes.md` (2026-08-08 entry).
- Follow-up action: If a second activity adopts `linkedSessionId`, consider whether single-hop propagation is still sufficient before extending it to chains.
- Owner: Codex

## Learn active-entry lifetime and fingerprint regression vector

- Date: 2026-08-08
- Contract: A Learn entry in `waiting` state is bounded by `data.expiresAt`; once `active`, its backing session-store TTL is the lifetime authority and is refreshed through the live session's `linkedSessionId`. Active-entry reads must not reject the mapping solely because its historical `data.expiresAt` has passed.
- Observability: Learn lifecycle logs use the documented HMAC fingerprints for provider, resource, mapping, and session identity. The exact shared test vector in `.agent/plans/learn-syncdeck-session-integration.md` is asserted in `activities/syncdeck/server/learnIntegration.test.ts`; change it only through a coordinated cross-system migration.
- Owner: Codex

## Activity normalizers preserve generic keepalive links

- Date: 2026-08-08
- Contract: An activity normalizer that reconstructs `session.data` must retain a valid generic `data.linkedSessionId`. SyncDeck's normalizer preserves the trimmed non-empty string so its Learn live session can keep the linked entry mapping alive.
- Validation: `server/sessionStore.test.ts` registers the real SyncDeck normalizer, writes a `syncdeck` record through `createSessionStore()`, and verifies both persistence and linked touch propagation.
- Owner: Codex

## Learn live-session link lifecycle

- Date: 2026-08-08
- Contract: A Learn-created SyncDeck session carries `linkedSessionId` only while its entry mapping is active. Learn stop and either instructor-activation rollback clear the link, but only if it still matches that mapping, so a stale socket cannot refresh a recreated entry mapping.
- Validation: `activities/syncdeck/server/learnIntegration.test.ts` verifies the link is absent from the live session after a Learn stop.
- Owner: Codex

## Cross-instance linked-session invalidation

- Date: 2026-08-08
- Contract: In the Valkey-backed store, a cached source record is re-read from Valkey at most once per five seconds before its `linkedSessionId` is propagated. This makes a remote stop/unlink authoritative within that bounded interval without a Valkey read for every websocket touch.
- Validation: `server/sessionStore.test.ts` uses two independent wrapped stores over one fake Valkey record map and verifies the second store does not refresh a target after the first store removes the link, while an immediate subsequent touch performs no extra read.
- Owner: Codex

## Learn lifecycle failure logging

- Date: 2026-08-08
- Contract: Instructor-start lifecycle errors use an allowlisted schema of event, operation, requestId, stable errorCode, identity fingerprints, and `sessionFingerprint`; error messages and arbitrary context values are excluded. Error logs never include raw Learn resource identifiers or internal session IDs.
- Validation: `activities/syncdeck/server/learnIntegration.test.ts` scans both captured info and error lifecycle logs, including a forced instructor-start failure containing sentinel resource, session, URL, and token values.
- Owner: Codex
- Date: 2026-09-02
- Surface: Video Sync REST | websocket | multi-instructor playback
- Contract: Video Sync playback state carries a monotonic `playbackRevision`, and manager commands carry a bounded unique `commandId` plus a per-page `managerId`. The server commits commands through `SessionStore.updateAtomic`, de-duplicates retries, and accepts a natural-ended pause from any capability-holding manager whose command names the current `playbackRevision` and reports an end position at/after `startSec` (and within `NATURAL_END_TOLERANCE_SEC` of `stopSec` when configured). It is deliberately **not** bound to `controllerId` (a per-page id) - that stranded playback as `isPlaying: true` when the manager that issued Play reloaded/closed/was autoplay-blocked and only another manager's player reached the media end. The YouTube manager iframe is a projection (`controls: 0`); activity-owned Play/Pause/Seek controls are the normal authority source, and play/pause use the server-projected position so a lagging manager cannot rewind the class. Two exceptions carry an explicit `startSec` instead (`resolveExplicitPlaybackPositionSec`): a Play after this player's own natural `ENDED`, and a Play while authoritative playback is parked at/past a configured `stopSec`. YouTube emits `PAUSED` (not `ENDED`) at a mid-video `endSeconds`, so `playerEndedRef` stays false there; without the `stopSec`-parked check a plain Play re-projects the boundary position and `applyStopIfReached` immediately re-pauses it, making a bounded clip impossible to replay. The manager Seek is routed through the **same** intent-flush queue as Play/Pause (not a bare `sendCommand`), so it serializes after an in-flight command and the server sees commands in gesture order (a delayed Play then Seek lands paused, not playing); a queued seek is dropped on a `[sessionId]` route swap along with `seekPositionInput`. The `natural-ended` pause is emitted outside that queue (it is a player event, not a control click) but now carries its **own** bounded auth-retry (`emitNaturalEndPause` → `shouldSendNaturalEndPause` precondition + the shared `resolveManagerPlaybackFlushOutcome` retry/drop decision, `MANAGER_PLAYBACK_COMMAND_RETRY_DELAY_MS` spacing, ≤ `MAX_MANAGER_PLAYBACK_FLUSH_RETRIES`): a transient 401/403 while the manager capability is mid-refresh no longer drops it and leaves the ended video as `isPlaying: true` for heartbeats to replay. The retry abandons itself once a newer gesture clears `playerEndedRef` or authoritative `playbackRevision` moves past the ended revision, and is cancelled at every player/session teardown.
- Compatibility constraints: Pre-migration playback state normalizes to revision `0`; missing controller IDs remain valid until the next explicit manager command. Processed command IDs are bounded to the newest 128 entries.
- Validation rules: Clients order playback first by `playbackRevision`, then use timestamps only within one revision. Telemetry/capability/socket writers must use atomic session mutation and must not persist an independently read whole-session snapshot. Every video-sync `updateVideoSyncSessionAtomic` call that had an authorizing/strict read now passes `{ expectedCreated }` from that read — command, config PATCH (incl. its `persistVideoSyncErrorAtomic` error writes), GET `/session` persist, `/event`, `/manager-access`, and the WS admission snapshot (bound to the incarnation the socket was authorized against). A same-id delete+recreate in the await window fails the mutation (→ 404 / socket close), never a no-op commit against the replacement. The two **delayed** telemetry writers that do carry a strict read — socket-cleanup connection telemetry and the in-process unsynced-student prune — now pass `{ expectedCreated }` from that read too: on mismatch the socket-cleanup write is skipped (no connection-change broadcast for the replacement) and the prune write is skipped **and** its stale bookkeeping is cleared rather than rescheduled. The unsynced-student auxiliary bookkeeping (in-memory `unsyncedStudentsBySession` map + prune timers, and the Valkey `video-sync:unsynced:` key) is keyed by a per-**incarnation** scope, `${sessionId}:${created}` (`unsyncedStudentScope`), not the bare id. So when an `/event` `mark`/`clear` is followed by an abandoned atomic write for a recreated id, that request's markers stay under the old scope — the replacement reads its own scope and never inherits them, the old Valkey key self-expires (`UNSYNCED_STUDENTS_KEY_TTL_MS`), and the old in-memory entry is swept by its own prune tick (which also re-checks the strict-read `created` and drops the scope on mismatch). `updateConnectionTelemetry` / the heartbeat / `GET /session` / the prune all pass `session.created` so every read/write targets the right scope; session teardown (`stopHeartbeat`) clears every `${sessionId}:` scope. No blind `DEL` of a shared key. Only the 3s heartbeat persist stays effectively self-healing (it does re-read strictly and passes `{ expectedCreated }` from that read; a mismatch tears the heartbeat down). When GET `/session` does persist (normalization / stop-reached / telemetry), its response body is now built from the **committed** record, not the pre-persist snapshot — a field a concurrent config PATCH changed (e.g. `standaloneMode`) is served fresh, so a reconnecting student never adopts a stale mode alongside fresh `state`.
- Store contract: `SessionStore.set()` does NOT bump `mutationRevision`. Once a session type routes any write through `updateAtomic`/`compareAndSet`, every writer for that type must do the same — a plain `set()` landing between an `updateAtomic` read and its compare-and-set carries the expected revision and is silently overwritten. `compareAndSet(id, expectedRevision, session, ttl?, expectedCreated?)` and `updateAtomic` now also bind the CAS to the session **incarnation**: `updateAtomic` passes the strict-read `created` as `expectedCreated`, and the commit (Valkey Lua `tostring(current.created) ~= ARGV[4]`; in-memory `current.created !== expectedCreated`) is refused if the stored `created` changed — a same-id delete+recreate resets `mutationRevision` to `0`, so a revision-only CAS has an ABA hole where a stale replacement overwrites the fresh incarnation. On a `created` mismatch `updateAtomic` re-reads (like a revision conflict); a stored record with no `created` degrades to the revision-only check. The in-process read cache routes every async fill through `SessionCache.replaceStaleFill(id, incoming, fillToken)`. `SessionCache` stamps each id's write generation from one cache-wide monotonic counter (`writeSeq`, advanced on `set` / `invalidate` / evict / miss); the caller captures its id's value with `beginFill(id)` just before its await. The fill lands only if that value is unchanged (nothing set/invalidated/deleted/evicted the slot during the await) or `cacheEntrySupersedes` still proves it newer. The per-id map is pruned on eviction/`cleanup()` even mid-fill — a pruned id reads back as the current `writeSeq` (ahead of every issued token), so a stalled fill can't collide onto a reset counter. `cacheEntrySupersedes` is same-incarnation-only (`created` **equal**, `mutationRevision >= cached`) — it never orders across incarnations, since `created` is a node-local `Date.now()` (a peer with a lagging clock can mint a smaller one). So a raced-behind read can't roll the cache back, a strict read racing a `delete` can't resurrect the session, and a recreated incarnation the caller actually read is published verbatim (generation unmoved). `set()` (authoritative whole-record write) stays unconditional. Residual: an identical id recreated within the same millisecond yields equal `created` (same assumption the route-level `expectedCreated` binding makes); a backend-monotonic per-id token would be the fuller fix. Video Sync's own routes only plain-`set` on `/create` (no concurrency) and in the minimal-store test fallback. **Known residual (tracked in #313):** the shared platform routes `POST /api/session/:sessionId/entry-participant` and `.../consume` (student join / accepted-participant handoff, used by `VideoSyncStudent`) still `get` + mutate `session.data` + plain `set()` on the *same* video-sync session record, so a student joining concurrently with an instructor playback command can lose one write or the other. They mutate a disjoint part of `session.data` (participant tokens, not `state`), so the practical failure is a dropped join token or a one-tick stale playback frame that the client `playbackRevision` guard then rejects. Full fix = migrate those routes to `updateAtomic` (#313). `createSessionStore.compareAndSet` runs `normalizeSessionData` on the candidate before persisting, matching `set()` (the Valkey CAS Lua script cannot), and both `compareAndSet` implementations touch an embedded child's parent session on success like `get()`/`getStrict()`.
- Evidence (schema/tests/path): `server/core/sessions.ts`; `server/core/valkeyStore.ts`; `activities/video-sync/server/routes.ts`; `activities/video-sync/client/protocol.ts`; `activities/video-sync/client/syncMath.ts`; Video Sync route/client tests.
- CAS compatibility clarification: The shared `SessionStore` interface exposes the optional `expectedCreated` argument. When a caller supplies it, both concrete stores require the persisted record to contain the exact same value; a missing stored identity fails closed. Revision-only compatibility is limited to callers that themselves read a legacy record without `created` and therefore pass no expected identity.
- Legacy identity propagation: `getSessionCreatedIdentity(record)` distinguishes a persisted `created` value from the synthetic timestamp exposed on a legacy record. Route-level authorization and atomic-update guards must use it rather than reading `record.created` directly, so the revision-only migration path remains available end-to-end.
- Cache ordering clarification: Once an async fill observes that its cache generation moved, only a **strictly greater** same-incarnation `mutationRevision` can supersede the current entry. Equal revisions are insufficient because direct legacy/plain `set()` writers retain their revision while replacing the record; the equal-revision fill is dropped.
- Cache miss completion: an async fill that authoritatively finds no record calls `invalidateStaleFill(id, fillToken)`, rather than unconditional invalidation. It removes a stale entry only while the fill still owns that generation, so a late miss cannot delete a concurrent `set`/CAS/newer fill.
- Cache fill ownership clarification: `beginFill(id)` claims (rather than merely reads) a fresh per-id generation. Concurrent fills therefore cannot share a token: a later-started strict read for a replacement incarnation prevents an older read that returns first from publishing, and then publishes the replacement itself.
- Follow-up action: Reuse the generic atomic mutation primitive when another activity requires cross-instance read/modify/write safety; do not duplicate activity-specific locking.
- Owner: Codex
