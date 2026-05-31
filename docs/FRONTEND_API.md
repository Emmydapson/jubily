# Frontend API Contract

Generated from the current NestJS controllers, DTOs, guards, Swagger decorators, and service response shapes. This file is frontend-facing and should be treated as the practical contract for the admin UI.

## Base API Behavior

Base URL placeholder:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
```

Swagger, when the server is reachable:

- UI: `GET /api`
- JSON: `GET /api-json`
- YAML: `GET /api-yaml`

Auth header for protected routes:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Login flow:

1. Call `POST /auth/login` with admin email/password.
2. Store `accessToken` in the frontend auth store.
3. Call `GET /auth/me` to hydrate the active admin profile.
4. Send `Authorization: Bearer <token>` on all protected admin routes.

Protected route behavior:

- Global JWT guard protects every route unless decorated with `@Public()`.
- Global roles guard checks `@Roles("ADMIN")` where present.
- Current dashboard routes are ADMIN-only except public tracking/webhook/OAuth callback endpoints.

Common errors:

| Status | Meaning | Frontend handling |
| --- | --- | --- |
| `400` | Validation failure, missing OAuth code, invalid settings | Show field or action error. |
| `401` | Missing/invalid token, invalid credentials, invalid OAuth state | Clear session and route to login, except public callback pages. |
| `403` | Authenticated but insufficient role | Show access denied. |
| `404` | Entity not found | Show not-found state. |
| `409` | Quality gate conflict, duplicate schedule slot, or render blocked | Show manual review/action-required state. |
| `429` | Login throttled | Show retry later. |
| `500` | Server or provider failure | Show retry/support state. |

Validation behavior:

- Request bodies and query params are validated with `whitelist`, `transform`, and `forbidNonWhitelisted`.
- Unknown body/query fields can fail validation. Send only documented fields.

Role requirements:

- Protected admin routes require role `ADMIN`.
- Public routes require no Jubily bearer token.

## Shared Shapes

Paginated list:

```ts
{
  items: T[];
  page: number;
  limit: number;
  total: number;
}
```

Video job summary:

```ts
{
  id: string;
  scriptId: string;
  topicId: string | null;
  topicTitle: string | null;
  title: string;
  offerId: string | null;
  offerName: string | null;
  status: string;
  provider: string | null;
  published: boolean;
  platform: "youtube" | null;
  slot: "MORNING" | "AFTERNOON" | "EVENING";
  scheduledFor: string;
  createdAt: string;
  attempts: number;
  error: string | null;
  renderId: string | null;
  videoUrl: string | null;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  hasCaptions: boolean;
  worker: {
    lockedAt: string | null;
    lockedBy: string | null;
    stage: string | null;
  };
}
```

## Endpoints

### App

#### `GET /`

- Auth: required
- Role: `ADMIN`
- Params/query/body: none
- Response: plain string, usually `"Hello World!"`
- Frontend note: health/debug only; not useful for normal dashboard UI.
- Common errors: `401`, `403`

### Auth

#### `POST /auth/login`

- Auth: public
- Role: none
- Body:

```ts
{
  email: string;    // valid email, must be allowed by ADMIN_EMAILS
  password: string; // min length 6
}
```

- Response:

```ts
{
  accessToken: string;
  admin: { id: string; email: string; role: "ADMIN" | string };
}
```

- Frontend note: throttle is enabled: 5 attempts per 60 seconds. Store token after success.
- Common errors: `400`, `401`, `429`

#### `GET /auth/me`

- Auth: required
- Role: `ADMIN`
- Response:

```ts
{
  id: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
} | null
```

- Frontend note: use on app boot to validate session.
- Common errors: `401`, `403`

### YouTube OAuth

#### `GET /auth/youtube`

- Auth: required
- Role: `ADMIN`
- Response: `302` redirect to Google OAuth consent URL.
- Side effects: sets `yt_oauth_state` and `yt_oauth_email` HTTP-only cookies scoped to `/auth/youtube/callback`.
- Frontend note: open as a full-page navigation or popup, not `fetch`, because it redirects.
- Common errors: `401`, `403`

#### `GET /auth/youtube/callback`

- Auth: public
- Query params:
  - `code?: string` required by backend logic
  - `state?: string` required to match state cookie
- Response: plain text: `YouTube connected. You can close this tab.`
- Frontend note: callback page is for Google redirect only. The dashboard can show instructions and let user close popup.
- Common errors: `400`, `401`

### Settings

#### `GET /settings`

- Auth: required
- Role: `ADMIN`
- Response:

```ts
{
  id: "app";
  automationEnabled: boolean;
  verticalEnabled: boolean;
  autoPublish: boolean;
  timezone: string;
  videosPerDay: number;
  runHours: number[];
  updatedAt: string;
}
```

- Frontend note: load once on Settings page and refresh after save.
- Common errors: `401`, `403`

#### `PATCH /settings`

- Auth: required
- Role: `ADMIN`
- Body: all fields optional

```ts
{
  automationEnabled?: boolean;
  verticalEnabled?: boolean;
  autoPublish?: boolean;
  timezone?: string;   // valid IANA timezone
  videosPerDay?: 1 | 2 | 3;
  runHours?: number[]; // integers 0..23, non-empty
}
```

- Response: updated settings object.
- Frontend note: validate timezone and hour range client-side before submit.
- Common errors: `400`, `401`, `403`

### API Keys

`provider` is Prisma `IntegrationProvider`:

```ts
"GOOGLE" | "OPENAI" | "DIGISTORE" | "CLICKBANK" | "YOUTUBE" | "SHOTSTACK"
```

#### `GET /settings/api-keys`

- Auth: required
- Role: `ADMIN`
- Response:

```ts
Array<{
  provider: string;
  masked: string;
  updatedAt: string;
  createdAt: string;
}>
```

- Frontend note: secrets are never returned.
- Common errors: `401`, `403`

#### `PUT /settings/api-keys/:provider`

- Auth: required
- Role: `ADMIN`
- Params: `provider`
- Body:

```ts
{ key: string } // min length 6
```

- Response:

```ts
{ provider: string; masked: string; updatedAt: string }
```

- Frontend note: clear the plaintext input after success.
- Common errors: `400`, `401`, `403`

#### `DELETE /settings/api-keys/:provider`

- Auth: required
- Role: `ADMIN`
- Params: `provider`
- Response: `{ ok: true }`
- Frontend note: require confirmation before deleting.
- Common errors: `400`, `401`, `403`

### Automation Topics

#### `POST /automation/topics`

- Auth: required
- Role: `ADMIN`
- Body:

```ts
{
  title: string;
  source?: string; // default "manual"
  score?: number;  // 0..100, default 50
}
```

- Response: `Topic`

```ts
{
  id: string;
  title: string;
  source: string;
  score: number;
  status: "PENDING" | "USED" | "REJECTED";
  createdAt: string;
  updatedAt: string;
}
```

- Frontend note: duplicate titles return the existing topic.
- Common errors: `400`, `401`, `403`

#### `GET /automation/topics`

- Auth: required
- Role: `ADMIN`
- Response: `Topic[]`, newest first.
- Frontend note: no pagination currently; avoid frequent polling if topic count grows.
- Common errors: `401`, `403`

#### `GET /automation/topics/pending`

- Auth: required
- Role: `ADMIN`
- Response: up to 5 pending topics.
- Frontend note: useful for dashboard queue widgets.
- Common errors: `401`, `403`

#### `PATCH /automation/topics/:id/used`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response: updated topic with `status: "USED"`.
- Frontend note: manual operation; confirm if topic state matters to scheduling.
- Common errors: `400`, `401`, `403`, `404`

#### `POST /automation/ingest`

- Auth: required
- Role: `ADMIN`
- Response: implementation-dependent, usually `{ ok: true, created: number }`.
- Frontend note: manual operation to fill pending topic pool; confirm before triggering.
- Common errors: `401`, `403`, provider/config errors

#### `POST /automation/topics/seed`

- Auth: required
- Role: `ADMIN`
- Response: `{ ok: true; created: number }`
- Frontend note: development/admin bootstrap action; require confirmation.
- Common errors: `401`, `403`

### Scripts

Script shape returned by list can include all Prisma `Script` fields:

```ts
{
  id: string;
  topicId: string;
  promptVer: string;
  content: string;
  outputHash: string;
  reviewStatus: "PENDING" | "APPROVED" | "NEEDS_REVIEW" | "REJECTED" | string;
  qualityScore: number | null;
  qualityReview: unknown | null;
  titleCandidates: unknown | null;
  selectedTitle: string | null;
  youtubeDescription: string | null;
  hashtags: string[];
  thumbnailPrompt: string | null;
  rewriteAttempts: number;
  createdAt: string;
}
```

#### `POST /automation/scripts`

- Auth: required
- Role: `ADMIN`
- Body:

```ts
{ topicId: string; content: string }
```

- Response: created/reused reviewed script.
- Frontend note: backend runs content-quality review and may rewrite content before persisting.
- Common errors: `400`, `401`, `403`, `404`

#### `POST /automation/scripts/ai`

- Auth: required
- Role: `ADMIN`
- Body:

```ts
{ topicId: string; topic: string }
```

- Response: created/reused AI-generated reviewed script.
- Frontend note: long-running provider call; show loading state and do not double-submit.
- Common errors: `400`, `401`, `403`, provider/config errors

#### `GET /automation/scripts`

- Auth: required
- Role: `ADMIN`
- Response: `Script[]`, newest first.
- Frontend note: no pagination; use sparingly or add pagination later.
- Common errors: `401`, `403`

#### `GET /automation/scripts/:id`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response: selected script fields including quality metadata.
- Frontend note: use for script detail/review screen.
- Common errors: `400`, `401`, `403`, `404`

### Script Quality Review

#### `GET /automation/scripts/:id/quality`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response:

```ts
{
  id: string;
  topicId: string;
  reviewStatus: "APPROVED" | "NEEDS_REVIEW" | "REJECTED" | "PENDING" | string;
  qualityScore: number | null;
  qualityReview: {
    score?: number;
    issues?: string[];
    strengths?: string[];
    dimensions?: Record<string, number>;
    adminReview?: { status: string; note: string | null; reviewedAt: string };
    [key: string]: unknown;
  } | null;
  titleCandidates: unknown | null;
  selectedTitle: string | null;
  youtubeDescription: string | null;
  hashtags: string[];
  thumbnailPrompt: string | null;
  rewriteAttempts: number;
  createdAt: string;
}
```

- Frontend note: display score, issues, strengths, metadata, and current gate status.
- Common errors: `400`, `401`, `403`, `404`

#### `PATCH /automation/scripts/:id/review-status`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Body:

```ts
{
  reviewStatus?: "APPROVED" | "NEEDS_REVIEW" | "REJECTED"; // defaults to APPROVED if omitted
  note?: string; // max 1000 chars
}
```

- Response: updated review metadata.
- Frontend note: this is the manual override. `APPROVED` allows automatic render and publish. Require confirmation for approve/reject.
- Common errors: `400`, `401`, `403`, `404`

#### `POST /automation/scripts/:id/review`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response: refreshed quality metadata.
- Frontend note: re-runs script quality review and rewrite attempts. It does not generate thumbnail images.
- Common errors: `400`, `401`, `403`, `404`, provider/config errors

### Orchestrator

Run slot body:

```ts
{
  slot: "MORNING" | "AFTERNOON" | "EVENING";
  scheduledFor?: string; // ISO date-time
}
```

#### `POST /automation/orchestrator/run`

- Auth: required
- Role: `ADMIN`
- Body: run slot body.
- Response: orchestrator result, commonly:

```ts
{
  ok: boolean;
  slot: string;
  jobId?: string;
  skipped?: boolean;
  reason?: string;
}
```

- Frontend note: manual operation; may create a render job only if script passes quality gate.
- Common errors: `400`, `401`, `403`, `409`, provider/config errors

#### `POST /automation/orchestrator/run-now`

- Auth: required
- Role: `ADMIN`
- Body: `{ slot }`; `scheduledFor` is ignored.
- Response: same as `/run`.
- Frontend note: manual immediate run; confirm before calling.
- Common errors: same as `/run`

### Jobs

#### `GET /automation/jobs`

- Auth: required
- Role: `ADMIN`
- Query:

```ts
{
  page?: number;       // default 1
  limit?: number;      // default 20, max 100
  status?: VideoJobStatus;
  published?: boolean; // accepts true/"true"
  slot?: "MORNING" | "AFTERNOON" | "EVENING";
  from?: string;       // ISO date-time
  to?: string;         // ISO date-time
  q?: string;          // topic/offer search
}
```

- Response: `PaginatedResponse<VideoJobSummary>`
- Frontend note: primary jobs list endpoint. Poll moderately while workers are active.
- Common errors: `400`, `401`, `403`

#### `GET /automation/jobs/summary`

- Auth: required
- Role: `ADMIN`
- Response:

```ts
{ failedToday: number; stuckProcessing: number }
```

- Frontend note: dashboard alert counters.
- Common errors: `401`, `403`

#### `GET /automation/jobs/workers/status`

- Auth: required
- Role: `ADMIN`
- Response:

```ts
{
  workersEnabled: boolean;
  automationEnabled: boolean;
  autoPublish: boolean;
  timezone: string;
  runHours: number[];
  videosPerDay: number;
  activeSchedule: Array<{ slot: string; hour: number; scheduledFor: string }>;
  pauseState: {
    newRenderStartsPaused: boolean;
    publishingPaused: boolean;
  };
  queues: {
    pendingRender: number;
    processingRender: number;
    readyToPublish: number;
    activeLeases: number;
    staleLeases: number;
    failedToday: number;
  };
  youtube: { tokenStorage: unknown };
  recentWorkerEvents: PipelineEvent[];
  checkedAt: string;
}
```

- Frontend note: poll on dashboard/worker panel every 15-30 seconds.
- Common errors: `401`, `403`

#### `GET /automation/jobs/:id`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response: `VideoJobSummary`
- Frontend note: use for job detail drawer/page.
- Common errors: `400`, `401`, `403`, `404`

#### `GET /automation/jobs/:id/assets`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response:

```ts
{
  job: VideoJobSummary;
  script: {
    id: string;
    content: string;
    promptVer: string;
    createdAt: string;
    topic: { id: string; title: string } | null;
  } | null;
  captionsSrt: string | null;
}
```

- Frontend note: use for script/captions/video asset panel.
- Common errors: `400`, `401`, `403`, `404`

#### `POST /automation/jobs/run-slot`

- Auth: required
- Role: `ADMIN`
- Body: `{ slot: "MORNING" | "AFTERNOON" | "EVENING"; scheduledFor?: string }`
- Response:

```ts
{
  ok: true;
  queued: true;
  slot: string;
  scheduledFor: string;
  note: string;
}
```

- Frontend note: async fire-and-return. After success, poll jobs and worker status.
- Common errors: `400`, `401`, `403`

#### `POST /automation/jobs/:id/retry`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response: `{ ok: true }`
- Frontend note: require confirmation; only makes sense for failed/stuck jobs.
- Common errors: `400`, `401`, `403`, `404`

### Videos

#### `GET /automation/videos`

- Auth: required
- Role: `ADMIN`
- Query:

```ts
{
  page?: number;
  limit?: number; // max 100
  status?: VideoJobStatus;
  published?: boolean;
  q?: string;
}
```

- Response: `PaginatedResponse<VideoJobSummary>`
- Frontend note: videos page can use this instead of jobs when focused on rendered/published videos.
- Common errors: `400`, `401`, `403`

#### `POST /automation/videos`

- Auth: required
- Role: `ADMIN`
- Body:

```ts
{
  jobId: string;
  videoUrl: string;
  youtubeUrl?: string;
  status?: VideoJobStatus;
  published?: boolean;
}
```

- Response: `VideoJobSummary`
- Frontend note: manual registration endpoint. Usually not used by normal dashboard except admin recovery tools.
- Common errors: `400`, `401`, `403`, `404`

#### `POST /automation/videos/:scriptId`

- Auth: required
- Role: `ADMIN`
- Params: `scriptId` UUID
- Body:

```ts
{
  offerId?: string;
  slot?: "MORNING" | "AFTERNOON" | "EVENING"; // default MORNING
  scheduledFor?: string; // ISO date-time, default now
}
```

- Response:

```ts
{ jobId: string; renderId: string; resumed?: boolean }
```

- Frontend note: starts render immediately. Blocked unless script review status is `APPROVED`.
- Common errors: `400`, `401`, `403`, `404`, `409`

#### `PATCH /automation/videos/:id/published`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response: `VideoJobSummary`
- Frontend note: manual override. Require confirmation because it marks job published.
- Common errors: `400`, `401`, `403`, `404`

#### `PATCH /automation/videos/:id/failed`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response: `VideoJobSummary`
- Frontend note: manual override. Require confirmation.
- Common errors: `400`, `401`, `403`, `404`

#### `GET /automation/videos/:id/assets`

- Auth: required
- Role: `ADMIN`
- Params: `id` UUID
- Response:

```ts
{
  job: VideoJobSummary;
  script: {
    id: string;
    content: string;
    promptVer: string;
    createdAt: string;
    topic: { id: string; title: string } | null;
  } | null;
  offer: { id: string; name: string; externalProductId: string | null } | null;
  captionsSrt: string | null;
}
```

- Frontend note: asset preview/detail endpoint.
- Common errors: `400`, `401`, `403`, `404`

### Workflow

#### `GET /automation/workflow/status`

- Auth: required
- Role: `ADMIN`
- Response:

```ts
{
  date: string;
  steps: Array<{ key: "trigger" | "topics" | "offers" | "scripts" | "render" | "publish" | "logging"; status: "pending" | "active" | "done" }>;
  slots: Record<"MORNING" | "AFTERNOON" | "EVENING", {
    steps: Array<{ key: string; status: "pending" | "active" | "done" }>;
    jobs: number;
  }>;
  summary: { jobs: number; published: boolean; failed: boolean };
}
```

- Frontend note: dashboard pipeline visualization. Poll every 15-30 seconds while active.
- Common errors: `401`, `403`

### Analytics

#### `GET /automation/analytics/weekly`

- Auth: required
- Role: `ADMIN`
- Query:
  - `days?: string | number` clamped 1..30, default 7
  - `tz?: string` IANA timezone, default `America/New_York`
- Response:

```ts
{
  timeZone: string;
  range: { from: string; to: string; days: number };
  points: Array<{ date: string; day: string; clicks: number; conversions: number; revenue: number }>;
  totals: { clicks: number; conversions: number; revenue: number };
}
```

- Frontend note: analytics charts/cards. Do not poll frequently; refresh on page load or filter change.
- Common errors: `401`, `403`

### Monitoring

#### `GET /monitoring/pipeline/health`

- Auth: required
- Role: `ADMIN`
- Response: `{ ok: true; route: "monitoring/pipeline"; timestamp: string }`
- Frontend note: admin health check.
- Common errors: `401`, `403`

#### `GET /monitoring/pipeline/events`

- Auth: required
- Role: `ADMIN`
- Query:

```ts
{
  limit?: number; // 1..200, default 50
  stage?: "IMAGE_GENERATION" | "RENDER" | "PUBLISH" | "TRACKING" | "CONVERSION";
  severity?: "INFO" | "WARN" | "ERROR";
  status?: string;
  jobId?: string;
  offerId?: string;
  clickId?: string;
  provider?: string;
  sinceHours?: number;
}
```

- Response: `PipelineEvent[]`
- Frontend note: monitoring/events page; poll only when live mode is enabled.
- Common errors: `400`, `401`, `403`

#### `GET /monitoring/pipeline/summary`

- Auth: required
- Role: `ADMIN`
- Query: `{ hours?: number }`
- Response:

```ts
{
  since: string;
  hours: number;
  totals: { events: number; errors: number; warns: number };
  byStage: Record<string, { total: number; errors: number; warns: number; lastEventAt: string | null }>;
}
```

- Frontend note: dashboard health cards.
- Common errors: `400`, `401`, `403`

### Publishing

#### `POST /automation/publish-result`

- Auth: required
- Role: `ADMIN`
- Body:

```ts
{
  jobId?: string;
  videoId?: string;
  platform: string;
  platformPostId: string;
  status: "SUCCESS" | "FAILED";
  errorMessage?: string;
}
```

- Response: updated `VideoJob` database row.
- Frontend note: manual/external publishing integration endpoint. Normal auto-publish uses the worker.
- Common errors: `400`, `401`, `403`, `404`

### Tracking

#### `GET /r/:offerId`

- Auth: public
- Params: `offerId` UUID
- Query:
  - `jobId?: string` UUID
  - `yt?: string` YouTube video ID
- Response: `302` redirect to affiliate offer URL. On failure, `500` plain text `Tracking redirect failed`.
- Frontend note: public viewer endpoint used in YouTube descriptions. Do not call from dashboard except to display/copy links.
- Common errors: `400`, `500`

### Webhooks

#### `POST /webhooks/digistore24`

- Auth: public
- Body: `application/x-www-form-urlencoded` Digistore24 IPN payload.
- Response: plain text `OK` for accepted, ignored, connection test, and logged failures.
- Frontend note: not a dashboard endpoint. Provider posts here.
- Common errors: intentionally hidden from provider; backend logs monitoring events instead.

#### `POST /webhooks/clickbank?key=:key`

- Auth: public
- Query:
  - `key?: string` required when `CLICKBANK_INS_ENABLED=true`
- Body: ClickBank INS JSON payload. Uses `tid`/`TID` for attribution.
- Response: plain text `OK` for accepted, ignored, rejected, and logged failures.
- Frontend note: not a dashboard endpoint. Provider posts here.
- Common errors: intentionally returns `OK` to avoid retry storms; inspect monitoring events for failures.

## Frontend Page Mapping

### Login Page

Endpoints:

- `POST /auth/login`
- `GET /auth/me` after token restore

UI states:

- Empty form, submitting, invalid credentials, throttled, authenticated redirect.

Actions/buttons:

- Sign in.

### Dashboard Page

Endpoints:

- `GET /automation/workflow/status`
- `GET /automation/jobs/workers/status`
- `GET /automation/jobs/summary`
- `GET /monitoring/pipeline/summary`
- `GET /automation/analytics/weekly`

UI states:

- Loading, automation paused, publishing paused, active queues, failed jobs, provider/config warnings.

Actions/buttons:

- Refresh, run slot, open failed jobs, open settings.

### Settings Page

Endpoints:

- `GET /settings`
- `PATCH /settings`

UI states:

- Loading, dirty form, saving, validation errors, saved.

Actions/buttons:

- Save settings, reset form.

### API Keys Page

Endpoints:

- `GET /settings/api-keys`
- `PUT /settings/api-keys/:provider`
- `DELETE /settings/api-keys/:provider`

UI states:

- Provider configured/unconfigured, saving, deleting, confirmation modal.

Actions/buttons:

- Save key, replace key, delete key.

### YouTube Connection Page

Endpoints:

- `GET /auth/youtube`
- `GET /auth/youtube/callback` is handled by Google redirect.
- `GET /automation/jobs/workers/status` for `youtube.tokenStorage`.

UI states:

- Not connected/unknown, connecting, connected, token storage warning.

Actions/buttons:

- Connect YouTube. Use browser navigation or popup.

### Jobs List Page

Endpoints:

- `GET /automation/jobs`
- `GET /automation/jobs/summary`
- `POST /automation/jobs/:id/retry`

UI states:

- Empty, filtering, active processing, failed, stale lease, published.

Actions/buttons:

- Filter, refresh, retry failed job, open job detail.

### Job Detail Page

Endpoints:

- `GET /automation/jobs/:id`
- `GET /automation/jobs/:id/assets`
- `POST /automation/jobs/:id/retry`
- `PATCH /automation/videos/:id/failed`
- `PATCH /automation/videos/:id/published`

UI states:

- Loading, missing assets, render pending, publish pending, failed, published.

Actions/buttons:

- Retry, mark failed, mark published, copy YouTube URL, view script/captions.

### Script Review Page

Endpoints:

- `GET /automation/scripts`
- `GET /automation/scripts/:id`
- `GET /automation/scripts/:id/quality`
- `PATCH /automation/scripts/:id/review-status`
- `POST /automation/scripts/:id/review`
- `POST /automation/videos/:scriptId`

UI states:

- Needs review, rejected, approved, re-reviewing, render blocked, render started.

Actions/buttons:

- Approve, reject, send back to needs review, regenerate/re-review, start render.

### Videos Page

Endpoints:

- `GET /automation/videos`
- `GET /automation/videos/:id/assets`
- `POST /automation/videos`
- `PATCH /automation/videos/:id/published`
- `PATCH /automation/videos/:id/failed`

UI states:

- Rendered, unrendered, published, unpublished, failed.

Actions/buttons:

- Refresh, open assets, register video manually, mark published, mark failed.

### Monitoring/Events Page

Endpoints:

- `GET /monitoring/pipeline/events`
- `GET /monitoring/pipeline/summary`
- `GET /monitoring/pipeline/health`

UI states:

- Live polling on/off, filtered events, errors/warnings, empty.

Actions/buttons:

- Filter, refresh, toggle live mode, open related job.

### Analytics Page

Endpoints:

- `GET /automation/analytics/weekly`

UI states:

- Loading, empty range, chart data, timezone/range selected.

Actions/buttons:

- Change days, change timezone, refresh.

### Manual Operations Page

Endpoints:

- `POST /automation/orchestrator/run`
- `POST /automation/orchestrator/run-now`
- `POST /automation/jobs/run-slot`
- `POST /automation/ingest`
- `POST /automation/topics/seed`
- `POST /automation/publish-result`

UI states:

- Confirming, queued, completed, failed, quality-gate blocked.

Actions/buttons:

- Run scheduled slot, run now, ingest topics, seed topics, register publish result.

## Suggested TypeScript Frontend Types

```ts
export interface Admin {
  id: string;
  email: string;
  role: "ADMIN" | string;
  active?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  admin: Admin;
}

export interface AppSettings {
  id: "app";
  automationEnabled: boolean;
  verticalEnabled: boolean;
  autoPublish: boolean;
  timezone: string;
  videosPerDay: number;
  runHours: number[];
  updatedAt: string;
}

export type ApiKeyProvider =
  | "GOOGLE"
  | "OPENAI"
  | "DIGISTORE"
  | "CLICKBANK"
  | "YOUTUBE"
  | "SHOTSTACK";

export interface ApiKeySummary {
  provider: ApiKeyProvider;
  masked: string;
  updatedAt: string;
  createdAt?: string;
}

export type VideoJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "FAILED_PERMANENT"
  | "FAILED_QUOTA"
  | "FAILED_PUBLISH";

export interface VideoJobSummary {
  id: string;
  scriptId: string;
  topicId: string | null;
  topicTitle: string | null;
  title: string;
  offerId: string | null;
  offerName: string | null;
  status: VideoJobStatus | string;
  provider: string | null;
  published: boolean;
  platform: "youtube" | null;
  slot: "MORNING" | "AFTERNOON" | "EVENING";
  scheduledFor: string;
  createdAt: string;
  attempts: number;
  error: string | null;
  renderId: string | null;
  videoUrl: string | null;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  hasCaptions: boolean;
  worker: {
    lockedAt: string | null;
    lockedBy: string | null;
    stage: string | null;
  };
}

export interface ScriptQuality {
  id: string;
  topicId: string;
  reviewStatus: "PENDING" | "APPROVED" | "NEEDS_REVIEW" | "REJECTED" | string;
  qualityScore: number | null;
  qualityReview: {
    score?: number;
    issues?: string[];
    strengths?: string[];
    dimensions?: Record<string, number>;
    adminReview?: {
      status: string;
      note: string | null;
      reviewedAt: string;
    };
    [key: string]: unknown;
  } | null;
  titleCandidates: unknown | null;
  selectedTitle: string | null;
  youtubeDescription: string | null;
  hashtags: string[];
  thumbnailPrompt: string | null;
  rewriteAttempts: number;
  createdAt: string;
}

export interface PipelineEvent {
  id: string;
  stage: "IMAGE_GENERATION" | "RENDER" | "PUBLISH" | "TRACKING" | "CONVERSION";
  severity: "INFO" | "WARN" | "ERROR";
  status: string;
  message: string;
  jobId: string | null;
  offerId: string | null;
  clickId: string | null;
  topicId: string | null;
  scriptId: string | null;
  provider: string | null;
  meta: unknown | null;
  createdAt: string;
}

export interface WorkerStatus {
  workersEnabled: boolean;
  automationEnabled: boolean;
  autoPublish: boolean;
  timezone: string;
  runHours: number[];
  videosPerDay: number;
  activeSchedule: Array<{
    slot: "MORNING" | "AFTERNOON" | "EVENING";
    hour: number;
    scheduledFor: string;
  }>;
  pauseState: {
    newRenderStartsPaused: boolean;
    publishingPaused: boolean;
  };
  queues: {
    pendingRender: number;
    processingRender: number;
    readyToPublish: number;
    activeLeases: number;
    staleLeases: number;
    failedToday: number;
  };
  youtube: { tokenStorage: unknown };
  recentWorkerEvents: PipelineEvent[];
  checkedAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
```

## Frontend Integration Warnings

Endpoints that return redirects:

- `GET /auth/youtube`
- `GET /r/:offerId`

Endpoints that return plain text:

- `GET /`
- `GET /auth/youtube/callback`
- `POST /webhooks/digistore24`
- `POST /webhooks/clickbank`
- `GET /r/:offerId` returns plain text only on failure.

Public endpoints not meant for dashboard API calls:

- `GET /auth/youtube/callback`
- `GET /r/:offerId`
- `POST /webhooks/digistore24`
- `POST /webhooks/clickbank`

Endpoints requiring manual confirmation:

- `DELETE /settings/api-keys/:provider`
- `PATCH /automation/scripts/:id/review-status`
- `POST /automation/scripts/:id/review`
- `POST /automation/videos/:scriptId`
- `PATCH /automation/videos/:id/published`
- `PATCH /automation/videos/:id/failed`
- `POST /automation/jobs/:id/retry`
- `POST /automation/orchestrator/run`
- `POST /automation/orchestrator/run-now`
- `POST /automation/jobs/run-slot`
- `POST /automation/ingest`
- `POST /automation/topics/seed`
- `POST /automation/publish-result`

Endpoints that should be polled:

- `GET /automation/jobs`
- `GET /automation/jobs/:id`
- `GET /automation/jobs/workers/status`
- `GET /automation/workflow/status`
- `GET /monitoring/pipeline/events` only in live mode.

Suggested polling intervals:

- Worker/dashboard state: 15-30 seconds.
- Job detail while processing: 10-15 seconds.
- Monitoring live mode: 10-30 seconds.

Endpoints that should not be called frequently:

- `POST /automation/scripts/ai`
- `POST /automation/scripts/:id/review`
- `POST /automation/orchestrator/run`
- `POST /automation/orchestrator/run-now`
- `POST /automation/jobs/run-slot`
- `POST /automation/ingest`
- `POST /automation/topics/seed`
- `GET /automation/analytics/weekly`
- `GET /automation/scripts`
- `GET /automation/topics`

Quality gate warning:

- Automatic render/publish only proceeds for scripts whose `reviewStatus` is `APPROVED`.
- `NEEDS_REVIEW`, `PENDING`, and `REJECTED` scripts should render as action-required in the frontend.
- Manual approval is `PATCH /automation/scripts/:id/review-status` with `reviewStatus: "APPROVED"`.

## Missing or Optional Backend Endpoints

These would improve the frontend but are not currently implemented here:

- Paginated scripts endpoint with filters by `reviewStatus`, topic, and date.
- Paginated topics endpoint with filters by `status`, source, and score.
- Dedicated YouTube connection status endpoint instead of reading `workers/status.youtube.tokenStorage`.
- Dedicated offers CRUD/list endpoints for selecting `offerId` during manual video creation.
- Endpoint to clear or force-release stale worker leases.
- Endpoint to pause/resume only render or only publish without changing broader settings.
- Endpoint to preview generated video metadata before publish.
- Endpoint to list publish history/results separately from `VideoJob`.
- Endpoint to download captions as `text/plain` or `.srt`.
- Endpoint to edit script content before approval.
- Endpoint to bulk approve/reject scripts.
- Backend-generated OpenAPI types package or stable `/api-json` availability in all environments.
