# Frontend API Contract

Source of truth for the customer app and admin console after the customer/admin split. Generated from the current NestJS controllers, DTOs, guards, services, and Prisma schema.

## API Base Rules

Base URL:

```ts
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
```

Swagger:

- `GET /api`
- `GET /api-json`
- `GET /api-yaml`

Standard JSON headers:

```http
Content-Type: application/json
Authorization: Bearer <accessToken>
```

Customer JWT vs admin JWT:

- Customer tokens come from `/auth/signup`, `/auth/login`, and `/auth/refresh`.
- Customer JWT payloads use `kind: "user"` and `role: "USER"`.
- Admin tokens come from `/admin/auth/login`.
- Admin JWT payloads use `kind: "admin"` and `role: "SUPER_ADMIN" | "ADMIN" | "SUPPORT"`.
- Customer JWTs do not satisfy admin routes.
- Admin JWTs do not satisfy customer workspace routes.
- Keep customer and admin sessions in separate frontend stores.

Workspace route rules:

- Send `x-workspace-id: <workspaceId>` on workspace-scoped customer routes without a `:workspaceId` path param.
- Routes with `:workspaceId` can use the route param alone.
- If both route param and `x-workspace-id` are present, they must match.
- Mismatch returns `403` with message `Workspace header does not match route workspace`.
- Workspace routes require customer JWT, verified email, active workspace, and membership.
- `OWNER` and `ADMIN` can mutate; `MEMBER` is read-only unless noted otherwise.

Common Nest error shape:

```ts
{
  statusCode: number;
  message: string | string[];
  error?: string;
}
```

Validation:

- Global validation uses `whitelist`, `transform`, and `forbidNonWhitelisted`.
- Do not send undocumented fields.
- UUID params are validated where controllers use `ParseUUIDPipe`.

Backend staging/sandbox configuration required for these routes:

```env
YOUTUBE_ADMIN_REDIRECT_URI=https://<api-host>/admin/auth/youtube/callback
YOUTUBE_CUSTOMER_REDIRECT_URI=https://<api-host>/workspaces/youtube/callback

EMAIL_PROVIDER=resend
RESEND_API_KEY=<resend sandbox/live api key>
EMAIL_FROM="Jubily <noreply@joinjubily.com>"
SUPPORT_EMAIL=info@joinjubily.com

STRIPE_ENABLED=true|false
STRIPE_SECRET_KEY=<stripe sandbox secret key>
STRIPE_WEBHOOK_SECRET=<stripe sandbox webhook signing secret>
STRIPE_PRO_MONTHLY_PRICE_ID=<stripe price id>
STRIPE_PRO_YEARLY_PRICE_ID=<stripe price id>
STRIPE_PREMIUM_MONTHLY_PRICE_ID=<stripe price id>
STRIPE_PREMIUM_YEARLY_PRICE_ID=<stripe price id>
# Optional - only needed when a Jubily promo code should apply a real Stripe discount.
# Replace JANE20 with the normalized uppercase promo code.
STRIPE_PROMO_JANE20_PROMOTION_CODE_ID=<stripe promotion code id>

PAYSTACK_ENABLED=true|false
PAYSTACK_SECRET_KEY=<paystack sandbox secret key>
PAYSTACK_WEBHOOK_SECRET=<paystack sandbox webhook signing secret>
PAYSTACK_PRO_MONTHLY_PLAN_CODE=<paystack plan code>
PAYSTACK_PRO_YEARLY_PLAN_CODE=<paystack plan code>
PAYSTACK_PREMIUM_MONTHLY_PLAN_CODE=<paystack plan code>
PAYSTACK_PREMIUM_YEARLY_PLAN_CODE=<paystack plan code>

BILLING_RETURN_BASE_URL=https://<frontend-host>
PUBLIC_API_BASE_URL=https://<api-host>
```

Notes:

- Production/staging requires the split YouTube redirect vars. Legacy `YOUTUBE_REDIRECT` is only a local/dev fallback.
- Resend sends mail from verified sender addresses; receiving mail for `info@joinjubily.com` still requires an actual mailbox provider.
- Enable only configured billing providers. If `STRIPE_ENABLED=true`, all Stripe keys and price IDs above are required. If `PAYSTACK_ENABLED=true`, Paystack secret and all plan codes above are required.
- Paystack webhook verification uses `PAYSTACK_WEBHOOK_SECRET` when set, otherwise `PAYSTACK_SECRET_KEY`.
- Billing checkout success/cancel URLs are built from `BILLING_RETURN_BASE_URL || PUBLIC_API_BASE_URL || JUBILY_API_BASE_URL`.

Common statuses:

| Status | Meaning |
| --- | --- |
| `400` | Invalid body/query/param, invalid OAuth code, unsupported provider |
| `401` | Missing/invalid token, invalid credentials, invalid/expired verification/reset/OAuth token |
| `403` | Wrong JWT kind, insufficient role, unverified email, suspended workspace |
| `404` | Entity not found or not in active workspace |
| `409` | Duplicate resource, script gate, plan limit, render/publish precondition |
| `429` | Throttled endpoint |
| `500` | Server/provider failure |

Shared enums:

```ts
type AdminRole = "SUPER_ADMIN" | "ADMIN" | "SUPPORT";
type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";
type Plan = "FREE" | "PRO" | "PREMIUM";
type SubscriptionStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "EXPIRED";
type BillingProvider = "PAYSTACK" | "STRIPE";
type BillingInterval = "monthly" | "yearly";
type PromoDiscountType = "PERCENTAGE" | "FIXED" | "NONE";
type PromoAppliesToPlan = "PRO" | "PREMIUM" | "ALL";
type PromoAttributionStatus = "SIGNUP" | "CHECKOUT_STARTED" | "SUBSCRIBED" | "FAILED" | "CANCELLED";
type RunSlot = "MORNING" | "AFTERNOON" | "EVENING";
type VideoJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "FAILED_PERMANENT" | "FAILED_QUOTA" | "FAILED_PUBLISH" | "CANCELLED";
type ScriptReviewStatus = "PENDING" | "APPROVED" | "NEEDS_REVIEW" | "REJECTED";
type ThumbnailStatus = "PENDING" | "GENERATING" | "READY" | "FAILED";
```

Paginated response:

```ts
{ items: T[]; page: number; limit: number; total: number }
```

## Customer Auth

### `POST /auth/signup`

Auth: public. Throttled at 5/min.

Request:

```ts
{ email: string; password: string; name?: string; promoCode?: string } // password min length 8
```

Response:

```ts
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: false;
    emailVerifiedAt: null;
  };
}
```

Notes: sends verification email; duplicate email returns `409`. If `promoCode` is sent, the backend normalizes it to uppercase, validates it, and records `SIGNUP` attribution against the new user/workspace without requiring payment.

### `POST /auth/login`

Auth: public. Throttled at 5/min plus failed-login backoff.

Request:

```ts
{ email: string; password: string } // password min length 6
```

Response:

```ts
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
  };
}
```

Notes: customer credentials only. Admins use `/admin/auth/login`.

### `GET /auth/me`

Auth: customer JWT.

Response:

```ts
{
  kind: "user";
  user: {
    id: string;
    email: string;
    name: string | null;
    active: boolean;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    passwordChangedAt: string | null;
    lastLoginAt: string | null;
    createdAt: string;
    memberships: Array<{
      role: WorkspaceRole;
      workspace: { id: string; name: string; slug: string | null };
    }>;
  };
} | null
```

### `POST /auth/verify-email`

Auth: public. Throttled at 10/min.

Request: `{ token: string }`

Response: `{ verified: true }`

### `POST /auth/resend-verification`

Auth: public. Throttled at 5/min.

Request: `{ email: string }`

Response: `{ ok: true }`

Note: returns `{ ok: true }` even when no email is sent.

### `POST /auth/forgot-password`

Auth: public. Throttled at 5/min.

Request: `{ email: string }`

Response: `{ ok: true }`

Note: returns `{ ok: true }` even when no active user exists.

### `POST /auth/reset-password`

Auth: public. Throttled at 5/min.

Request:

```ts
{ token: string; password: string } // password min length 8
```

Response: `{ ok: true }`

Note: revokes all customer refresh sessions.

### `POST /auth/refresh`

Auth: public. Throttled at 30/min.

Request: `{ refreshToken: string }`

Response:

```ts
{
  accessToken: string;
  refreshToken: string; // rotated; replace the old one
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
  };
}
```

### `POST /auth/logout`

Auth: customer JWT.

Request: `{ refreshToken: string }`

Response: `{ ok: true }`

### `POST /auth/logout-all`

Auth: customer JWT.

Request: none.

Response: `{ ok: true }`

## Admin Auth

### `POST /admin/auth/login`

Auth: public. Throttled at 5/min plus failed-login backoff.

Request:

```ts
{ email: string; password: string } // password min length 6
```

Response:

```ts
{
  accessToken: string;
  admin: { id: string; email: string; role: AdminRole };
}
```

Admin JWT behavior:

- JWT payload has `kind: "admin"`.
- No admin refresh endpoint exists.
- If `ADMIN_EMAILS` is configured, the email must be allowlisted.
- Admin must exist in `AdminUser` and be active.

### `GET /admin/auth/me`

Auth: admin JWT.

Response:

```ts
{
  kind: "admin";
  admin: {
    id: string;
    email: string;
    role: AdminRole;
    active: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  };
} | null
```

## Customer Workspaces

### `POST /workspaces`

Auth: customer JWT. Email must be verified.

Request:

```ts
{ name: string; slug?: string } // name min length 2
```

Response:

```ts
{
  id: string;
  name: string;
  slug: string | null;
  ownerId: string;
  suspended: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  updatedAt: string;
  members: Array<{ role: "OWNER" }>;
}
```

Notes: `slug` is normalized to lowercase kebab-case, max 80 chars.

### `GET /workspaces`

Auth: customer JWT.

Response:

```ts
Array<{
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  updatedAt: string;
  role: WorkspaceRole;
}>
```

### `GET /workspaces/:workspaceId`

Auth: customer JWT and workspace membership.

Response: `{ id: string; role: WorkspaceRole }`

### `GET /workspaces/:workspaceId/dashboard`

Auth: customer JWT and workspace membership.

Response:

```ts
{
  workspace: { id: string; name: string; slug: string | null };
  counts: {
    offers: number;
    topics: number;
    scripts: number;
    videoJobs: number;
    published: number;
  };
  youtube: YoutubeDiagnostics;
}
```

### `GET /workspaces/:workspaceId/youtube`

Auth: customer JWT and workspace membership.

Response:

```ts
type YoutubeDiagnostics = {
  connected: boolean;
  channelId: string | null;
  title: string | null;
  customUrl: string | null;
  subscriberCount: string | null;
  videoCount: string | null;
  statistics: {
    viewCount: string | null;
    subscriberCount: string | null;
    hiddenSubscriberCount: boolean | null;
    videoCount: string | null;
  } | null;
  targetChannelId: string | null;
  channelMatchesTarget: boolean | null;
  scope: string | null;
  tokenStorage: {
    encryptedDbConfigured: boolean;
    encryptedDbUpdatedAt: string | null;
    legacyFilePresent: boolean;
    legacyFileWriteFallbackEnabled: boolean;
  };
  error: string | null;
}
```

Workspace YouTube diagnostics always return `targetChannelId: null`, `channelMatchesTarget: null`, `legacyFilePresent: false`, and `legacyFileWriteFallbackEnabled: false`.

### `POST /workspaces/:workspaceId/youtube/connect`

Auth: customer JWT and workspace `OWNER` or `ADMIN`. Throttled at 10/min.

Request: none.

Response: `{ url: string }`

Frontend flow: call with customer bearer token, navigate/popup to `url`, then Google redirects to `/workspaces/youtube/callback`.

### `DELETE /workspaces/:workspaceId/youtube`

Auth: customer JWT and workspace `OWNER` or `ADMIN`.

Response: `{ connected: false }`

### `GET /workspaces/youtube/callback`

Auth: public. Throttled at 30/min.

Query: `{ code: string; state: string }`

Response: plain text `YouTube connected. You can close this tab.`

Notes: state expires after 10 minutes and validates that the original user still has workspace `OWNER` or `ADMIN`.

## Customer Product / Offer API

All `/offers` routes require customer JWT, verified email, workspace membership, and `x-workspace-id`.

Supported networks:

```ts
type OfferNetwork = "digistore24" | "clickbank";
```

Supported niches/categories:

```ts
type OfferNiche =
  | "sleep"
  | "weight-loss"
  | "energy"
  | "stress"
  | "gut-health"
  | "focus"
  | "fitness"
  | "hormones"
  | "memory"
  | "mens-health"
  | "dental-health"
  | "joint-health"
  | "hearing-health";
```

Beginner-facing meanings:

- Affiliate link: `hoplink`, the product URL that receives viewer traffic.
- Network: `network`, the affiliate provider. ClickBank tracking uses `tid`; Digistore24 uses `custom`.
- Niche/category: `nicheTag`, used for filtering and topic-offer matching.
- Product description: no backend field exists. Use `name`, `nicheTag`, and wizard `prompt` for positioning copy.

Offer shape:

```ts
{
  id: string;
  workspaceId: string | null;
  network: OfferNetwork;
  externalProductId: string | null;
  name: string;
  nicheTag: OfferNiche | null;
  hoplink: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { clicks: number; conversions: number; videoJobs: number };
}
```

### `GET /offers`

Auth: workspace membership.

Query:

```ts
{
  page?: number;      // default 1
  limit?: number;     // default 50, max 100
  network?: OfferNetwork;
  nicheTag?: OfferNiche;
  active?: boolean;
  q?: string;
}
```

Response: `{ items: Offer[]; page: number; limit: number; total: number }`

### `GET /offers/:id`

Auth: workspace membership.

Params: `id` UUID.

Response: `Offer`.

### `POST /offers`

Auth: workspace `OWNER` or `ADMIN`.

Request:

```ts
{
  network: OfferNetwork;
  name: string;
  hoplink: string; // valid http(s) URL
  nicheTag?: OfferNiche;
  externalProductId?: string;
  active?: boolean; // default true
}
```

Response: created `Offer`.

### `PATCH /offers/:id`

Auth: workspace `OWNER` or `ADMIN`.

Request: partial create body; at least one field.

```ts
{
  network?: OfferNetwork;
  name?: string;
  hoplink?: string;
  nicheTag?: OfferNiche;
  externalProductId?: string;
  active?: boolean;
}
```

Response: updated `Offer`.

### `POST /offers/:id/deactivate`

Auth: workspace `OWNER` or `ADMIN`.

Response: updated `Offer` with `active: false`.

### `POST /offers/:id/reactivate`

Auth: workspace `OWNER` or `ADMIN`.

Response: updated `Offer` with `active: true`.

### `GET /offers/:id/performance`

Auth: workspace membership.

Response:

```ts
{
  offer: Offer;
  totals: {
    clicks: number;
    conversions: number;
    videoJobs: number;
    conversionRate: number;
    revenueByCurrency: Array<{ currency: string; conversions: number; amount: number }>;
  };
  recent: { lastClickAt: string | null; lastConversionAt: string | null };
}
```

### `POST /offers/:id/test-redirect`

Auth: workspace membership.

Response:

```ts
{
  offerId: string;
  network: OfferNetwork;
  hoplink: string;
  previewClickId: string;
  redirectUrl: string;
  createsClick: false;
}
```

## Customer Video Wizard

All routes here require customer JWT, verified email, workspace membership, and `x-workspace-id`.

Customer render starts use `POST /automation/videos/:scriptId`. Do not call the admin manual render route from the customer app.

Script shape:

```ts
{
  id: string;
  workspaceId: string | null;
  topicId: string;
  promptVer: string;
  content: string;
  outputHash: string;
  reviewStatus: ScriptReviewStatus;
  qualityScore: number | null;
  qualityReview: unknown | null;
  titleCandidates: unknown | null;
  selectedTitle: string | null;
  youtubeDescription: string | null;
  hashtags: string[];
  thumbnailPrompt: string | null;
  thumbnailImageUrl: string | null;
  thumbnailStatus: ThumbnailStatus | string;
  thumbnailError: string | null;
  thumbnailGeneratedAt: string | null;
  rewriteAttempts: number;
  createdAt: string;
}
```

Customer video status shape:

```ts
{
  id: string;
  scriptId: string;
  topicId: string | null;
  topicTitle: string | null;
  title: string;
  offerId: string | null;
  offerName: string | null;
  status: VideoJobStatus;
  provider: string | null;
  published: boolean;
  platform: "youtube" | null;
  slot: RunSlot;
  scheduledFor: string;
  createdAt: string;
  attempts: number;
  error: string | null;
  renderId: string | null;
  videoUrl: string | null;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  hasCaptions: boolean;
  worker: { lockedAt: string | null; lockedBy: string | null; stage: string | null };
  thumbnail: {
    prompt: string | null;
    imageUrl: string | null;
    status: ThumbnailStatus | string;
    error: string | null;
    generatedAt: string | null;
  };
  qa: {
    durationSeconds: number | null;
    sceneCount: number | null;
    hasBurnedSubtitles: boolean;
    hasTrackingLink: boolean;
    shotstackPayloadDebugPath: string | null;
  };
  renderStatus: "NOT_STARTED" | "SUBMITTED" | "PROCESSING" | "READY";
  progress: number | null;
  trackingUrl: string | null;
}
```

Status and failure fields:

- `PENDING`: job exists, waiting for render.
- `PROCESSING`: render submitted/in progress.
- `COMPLETED`: render complete; `videoUrl` should be available before publish.
- `FAILED`, `FAILED_PERMANENT`, `FAILED_QUOTA`, `FAILED_PUBLISH`: show `error`.
- `CANCELLED`: stopped by admin.
- Thumbnail failures use `thumbnail.status: "FAILED"` and `thumbnail.error`.

Polling:

- Poll `GET /automation/videos/:id` every 10-15 seconds while `PENDING` or `PROCESSING`.
- Stop when `COMPLETED` with `videoUrl`, any `FAILED*`, or `CANCELLED`.
- After publish, poll until `published: true` and `youtubeUrl` exists, or failure appears.

### `POST /automation/scripts/ai-from-offer`

Auth: workspace membership. Throttled at 20/min.

Request:

```ts
{
  offerId: string; // UUID; offer must belong to active workspace
  topic?: string;  // min 1, max 240
  prompt?: string; // max 1000
}
```

Response: `Script`.

Notes: creates/reuses a `Topic` with `source: "wizard"` and consumes one AI generation for billable workspaces.

### `PATCH /automation/scripts/:id`

Auth: workspace `OWNER` or `ADMIN`.

Request:

```ts
{
  title?: string;       // max 120; maps to selectedTitle
  content?: string;
  description?: string; // max 4500; maps to youtubeDescription
  hashtags?: string[];  // normalized and max 18
}
```

Response: updated script subset with content, review, metadata, thumbnail fields, and `createdAt`.

### `GET /automation/scripts/:id`

Auth: workspace membership.

Response: `Script` plus `topic: { title: string }`.

### `GET /automation/scripts/:id/quality`

Auth: workspace membership.

Response: script quality metadata:

```ts
{
  id: string;
  topicId: string;
  workspaceId: string | null;
  reviewStatus: ScriptReviewStatus;
  qualityScore: number | null;
  qualityReview: unknown | null;
  titleCandidates: unknown | null;
  selectedTitle: string | null;
  youtubeDescription: string | null;
  hashtags: string[];
  thumbnailPrompt: string | null;
  thumbnailImageUrl: string | null;
  thumbnailStatus: ThumbnailStatus | string;
  thumbnailError: string | null;
  thumbnailGeneratedAt: string | null;
  rewriteAttempts: number;
  createdAt: string;
}
```

### `PATCH /automation/scripts/:id/review-status`

Auth: workspace `OWNER` or `ADMIN`.

Request:

```ts
{
  reviewStatus?: "APPROVED" | "NEEDS_REVIEW" | "REJECTED"; // defaults to APPROVED
  note?: string; // max 1000
}
```

Response: updated review metadata. `APPROVED` is required before render/publish.

### `POST /automation/scripts/:id/review`

Auth: workspace `OWNER` or `ADMIN`. Throttled at 20/min.

Request: none.

Response: refreshed quality metadata. Consumes one AI generation for billable workspaces.

### `POST /automation/videos/:scriptId`

Auth: workspace `OWNER` or `ADMIN`. Throttled at 10/min.

Purpose: start video creation/render for an approved script in the active workspace.

Request:

```ts
{
  offerId?: string;       // UUID; offer must belong to active workspace
  slot?: RunSlot;         // defaults to MORNING
  scheduledFor?: string;  // ISO date-time; defaults to now
}
```

Response:

```ts
{
  videoId: string; // VideoJob.id
  scriptId: string;
  status: VideoJobStatus;
  renderStatus: "NOT_STARTED" | "SUBMITTED" | "PROCESSING" | "READY";
  progress: number | null;
  trackingUrl: string | null;
  message: "Render started" | "Render already started";
}
```

Rules:

- Requires customer JWT, verified email, `x-workspace-id`, and workspace membership.
- Requires workspace `OWNER` or `ADMIN`; `MEMBER` is rejected with `403`.
- Script must belong to the active workspace.
- Script `reviewStatus` must be `APPROVED`; otherwise the backend returns `409`.
- Optional `offerId` must belong to the active workspace.
- Billing video-generation limit is enforced before the render provider is called.
- Uses the same render service path as `POST /admin/manual-ops/videos/:scriptId/render`.
- Response is intentionally customer-safe and does not include `renderId`, worker lease fields, provider debug paths, or admin-only internals.

### `GET /automation/videos/:id`

Auth: workspace membership.

Params: `id` UUID, the `VideoJob.id`.

Response: customer video status shape.

Important fields:

- `trackingUrl`: public affiliate redirect URL or `null`.
- `youtubeUrl`: populated after successful publish.
- `error`: render/publish failure reason.
- `thumbnail.error`: thumbnail failure reason.

### `GET /automation/videos`

Auth: workspace membership.

Query:

```ts
{
  page?: number;      // default 1
  limit?: number;     // default 20, max 100
  status?: VideoJobStatus;
  published?: boolean;
  q?: string;
}
```

Response: `{ items: VideoJobCustomerStatus[]; page: number; limit: number; total: number }`

### `GET /automation/videos/:id/assets`

Auth: workspace membership.

Response:

```ts
{
  job: VideoJobCustomerStatus;
  script: {
    id: string;
    content: string;
    promptVer: string;
    createdAt: string;
    thumbnailPrompt: string | null;
    thumbnailImageUrl: string | null;
    thumbnailStatus: ThumbnailStatus | string;
    thumbnailError: string | null;
    thumbnailGeneratedAt: string | null;
    topic: { id: string; title: string } | null;
  } | null;
  captionsSrt: string | null;
}
```

### `POST /automation/videos/:id/publish`

Auth: workspace `OWNER` or `ADMIN`. Throttled at 10/min.

Request: none.

Queued response:

```ts
{
  queued: true;
  status: "QUEUED_FOR_PUBLISH";
  trackingUrl: string | null;
  job: VideoJobCustomerStatus;
}
```

Already handled response:

```ts
{
  queued: false;
  status: "PUBLISHED" | "ALREADY_QUEUED";
  job: VideoJobCustomerStatus;
}
```

Preconditions: script `APPROVED`, job `COMPLETED`, `renderId` present, workspace YouTube connected, publish limit available.

## Promo Codes

Promo codes are normalized server-side by trimming whitespace and uppercasing. The public validation endpoint only returns safe promo metadata; it does not expose users, workspaces, attribution rows, or revenue.

Discount behavior:

- `discountType: "NONE"` means tracking-only.
- Stripe discounts are applied only when the backend has `STRIPE_PROMO_<CODE>_PROMOTION_CODE_ID` configured and the provider checkout request includes the real Stripe promotion code id.
- Paystack promo codes are attribution/tracking-only unless a real adjusted-plan strategy is configured server-side later. The backend does not fake a discount.
- `redemptionCount` increments only after a successful subscription webhook marks an attribution `SUBSCRIBED`.

Promo code shape:

```ts
type PromoCode = {
  id: string;
  code: string; // normalized uppercase
  influencerName: string;
  influencerEmail: string | null;
  description: string | null;
  discountType: PromoDiscountType;
  discountValue: number | null;
  appliesToPlans: PromoAppliesToPlan;
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### `POST /promo-codes/validate`

Auth: public. Throttled at 30/min.

Use this on signup/pricing forms before submitting signup or checkout. Invalid, inactive, expired, over-limit, or plan-inapplicable codes return `400`.

Request:

```ts
{
  code: string;
  plan?: "PRO" | "PREMIUM" | "FREE";
}
```

Response:

```ts
{
  valid: true;
  promo: {
    code: string;
    influencerName: string;
    discountType: PromoDiscountType;
    discountValue: number | null;
    appliesToPlans: PromoAppliesToPlan;
    planApplies: boolean;
    trackingOnly: boolean;
    stripeDiscountConfigured: boolean;
  };
}
```

## Billing

### `GET /billing/plans`

Auth: public by controller.

Response:

```ts
Array<{
  plan: Plan;
  limits: {
    videoGenerations: number;
    publishes: number;
    aiGenerations: number;
    renderMinutes: number;
    storageBytes: string;
  };
}>
```

Current limits:

```ts
FREE:    { videoGenerations: 3, publishes: 1, aiGenerations: 10, renderMinutes: 90, storageBytes: "524288000" }
PRO:     { videoGenerations: 50, publishes: 25, aiGenerations: 200, renderMinutes: 1500, storageBytes: "10737418240" }
PREMIUM: { videoGenerations: 200, publishes: 100, aiGenerations: 1000, renderMinutes: 6000, storageBytes: "53687091200" }
```

### `GET /billing/subscription`

Auth: workspace membership.

Response:

```ts
{
  id: string;
  workspaceId: string;
  plan: Plan;
  status: SubscriptionStatus;
  billingProvider: BillingProvider | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  effectivePlan: Plan;
  limits: { videoGenerations: number; publishes: number; aiGenerations: number; renderMinutes: number; storageBytes: string };
}
```

### `GET /billing/usage`

Auth: workspace membership.

Response:

```ts
{
  usage: {
    id: string;
    workspaceId: string;
    periodStart: string;
    periodEnd: string;
    videoGenerations: number;
    publishes: number;
    aiGenerations: number;
    renderMinutes: number;
    storageBytes: string;
    createdAt: string;
    updatedAt: string;
  };
  plan: Plan;
  limits: { videoGenerations: number; publishes: number; aiGenerations: number; renderMinutes: number; storageBytes: string };
}
```

### `POST /billing/start-checkout`

Auth: workspace `OWNER` or `ADMIN`. Throttled at 10/min.

Request:

```ts
{
  plan?: "PRO" | "PREMIUM";       // defaults to PRO; FREE rejected
  provider?: "PAYSTACK" | "STRIPE";
  interval?: "monthly" | "yearly"; // defaults monthly
  country?: string;                // 2 letters; used for provider auto-select
  promoCode?: string;              // optional; normalized and validated server-side
}
```

Provider selection:

- Explicit provider must be `PAYSTACK` or `STRIPE`.
- Omitted provider selects `PAYSTACK` for `NG`, `GH`, `ZA`, `KE`, `CI`, `EG`, `RW`; otherwise `STRIPE`.

Response:

```ts
{
  provider: BillingProvider;
  checkoutUrl: string;
  reference: string;
  sessionId?: string | null;
  promo: null | {
    code: string;
    discountType: PromoDiscountType;
    discountApplied: boolean; // true only when a real provider discount was attached
  };
}
```

Promo behavior:

- Invalid, inactive, expired, over-limit, or plan-inapplicable promo codes return `400`.
- Checkout records `CHECKOUT_STARTED` attribution before provider checkout is created.
- Stripe checkout metadata and subscription metadata include promo attribution fields.
- Paystack checkout metadata includes promo attribution fields, but `discountApplied` remains `false` unless the payment amount is actually adjusted server-side.

Return URLs sent to the provider:

- Success: `${BILLING_RETURN_BASE_URL || PUBLIC_API_BASE_URL || JUBILY_API_BASE_URL}/billing/success`
- Cancel: `${BILLING_RETURN_BASE_URL || PUBLIC_API_BASE_URL || JUBILY_API_BASE_URL}/billing/cancel`

The frontend should provide matching pages and refresh subscription state after redirect.

### `POST /billing/cancel`

Auth: workspace `OWNER` or `ADMIN`. Throttled at 10/min.

Request: none.

Response: subscription shape with `cancelAtPeriodEnd: true`; trialing subscriptions become `CANCELED`.

## Customer Analytics / Tracking

### `GET /offers/:id/performance`

Offer-level performance endpoint. See Customer Product / Offer API.

### `GET /automation/analytics/weekly`

Auth: workspace membership.

Query:

```ts
{ days?: string | number; tz?: string } // days clamped 1..30, default 7; tz default America/New_York
```

Response:

```ts
{
  timeZone: string;
  range: { from: string; to: string; days: number };
  points: Array<{ date: string; day: string; clicks: number; conversions: number; revenue: number }>;
  totals: { clicks: number; conversions: number; revenue: number };
}
```

### Tracking redirect URL

Public:

```http
GET /r/:offerId?jobId=:videoJobId&yt=:youtubeVideoId
```

Behavior:

- Creates a click.
- Redirects to offer `hoplink`.
- Adds click id as `tid` for ClickBank and `custom` for Digistore24.
- Optional `AFFILIATE_CLICK_PARAM` adds a second click-id query param.
- Failure returns `500` plain text `Tracking redirect failed`.

`trackingUrl` returned from video APIs is built as:

```ts
`${PUBLIC_API_BASE_URL || JUBILY_API_BASE_URL}/r/${offerId}?jobId=${jobId}&yt=${youtubeVideoId}`
```

It is `null` when no offer exists or no public API base URL is configured.

## Admin API

Admin routes require admin JWT unless public. `@Roles("ADMIN")` accepts `SUPER_ADMIN`, `ADMIN`, and `SUPPORT`.

### `/admin/auth/*`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/admin/auth/login` | Admin login | Public | `{ email; password }` | `{ accessToken; admin }` |
| `GET` | `/admin/auth/me` | Current admin profile | Any active admin | none | `{ kind: "admin"; admin } \| null` |
| `GET` | `/admin/auth/youtube` | Redirect to global/admin YouTube OAuth | Any active admin | none | `302` |
| `POST` | `/admin/auth/youtube/connect` | Create global/admin YouTube OAuth URL | Any active admin | none | `{ url: string }` |
| `GET` | `/admin/auth/youtube/channel` | Global/admin YouTube diagnostics | Any active admin | none | `YoutubeDiagnostics` |
| `GET` | `/admin/auth/youtube/callback` | Google callback | Public | query `{ code; state }` | plain text |

### `/admin/workflow/*`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/admin/workflow/status` | Workflow dashboard status | Admin role | none | `WorkflowService.getStatus()` object |

### `/admin/manual-ops/*`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/admin/manual-ops/ingest` | Ingest topics now | Admin role | none | `{ ok: true; created: number }` |
| `POST` | `/admin/manual-ops/topics/seed` | Seed default topics | Admin role | none | `{ ok: true; created: number }` |
| `POST` | `/admin/manual-ops/orchestrator/run` | Run orchestrator slot | Admin role | `RunSlotDto` | orchestrator result |
| `POST` | `/admin/manual-ops/orchestrator/run-now` | Run slot immediately | Admin role | `RunSlotDto` | orchestrator result |
| `POST` | `/admin/manual-ops/publish-result` | Register manual publish result | Admin role | `PublishResultDto` | updated `VideoJob` row |

```ts
type RunSlotDto = { slot: RunSlot; scheduledFor?: string; force?: boolean };
type PublishResultDto = {
  jobId?: string;
  videoId?: string;
  platform: string;
  platformPostId: string;
  status: "SUCCESS" | "FAILED";
  errorMessage?: string;
};
```

### `/admin/manual-ops/videos/*`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/admin/manual-ops/videos` | Register rendered video | Admin role | `RegisterVideoDto` | customer video status |
| `PATCH` | `/admin/manual-ops/videos/:id/published` | Mark job published | Admin role | none | customer video status |
| `PATCH` | `/admin/manual-ops/videos/:id/failed` | Mark job failed | Admin role | none | customer video status |
| `POST` | `/admin/manual-ops/videos/:scriptId/render` | Render from approved script | Admin role | `CreateVideoJobDto` | `{ jobId; renderId; resumed?; qa? }` |

```ts
type RegisterVideoDto = {
  jobId: string;
  videoUrl: string;
  youtubeUrl?: string;
  status?: VideoJobStatus;
  published?: boolean;
};
type CreateVideoJobDto = {
  offerId?: string;
  slot?: RunSlot;        // default MORNING
  scheduledFor?: string; // default now
};
```

### `/admin/jobs/*`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/admin/jobs` | List jobs | Admin role | query `ListJobsQueryDto` | paginated `VideoJobSummary` |
| `GET` | `/admin/jobs/summary` | Failure summary | Admin role | none | `{ failedToday; stuckProcessing }` |
| `GET` | `/admin/jobs/workers/status` | Worker/queue status | Admin role | none | worker status object |
| `GET` | `/admin/jobs/:id` | Job detail | Admin role | UUID | `VideoJobSummary` |
| `GET` | `/admin/jobs/:id/assets` | Job assets/captions | Admin role | UUID | `{ job; script; captionsSrt }` |
| `POST` | `/admin/jobs/run-slot` | Queue schedule slot async | Admin role | `RunSlotDto` | `{ ok; queued; slot; scheduledFor; force; note }` |
| `POST` | `/admin/jobs/:id/cancel` | Cancel job | Admin role | `{ status?: "CANCELLED" \| "FAILED_PERMANENT" }` | `{ ok: true }` |
| `POST` | `/admin/jobs/:id/reset-render` | Reset failed render | Admin role | none | `{ ok: true }` |
| `POST` | `/admin/jobs/:id/retry` | Retry job | Admin role | none | `{ ok: true }` |

```ts
type ListJobsQueryDto = {
  page?: number;
  limit?: number;
  status?: VideoJobStatus;
  published?: boolean;
  slot?: RunSlot;
  from?: string;
  to?: string;
  q?: string;
};
```

### `/admin/logs/automation`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/admin/logs/automation` | Google Sheets automation logs | Admin role | query `{ limit?: number }`, max 200 | `{ items: AutomationLogItem[] }` |

```ts
type AutomationLogItem = {
  jobId: string | null;
  scriptId: string | null;
  topicTitle: string | null;
  offerName: string | null;
  platform: string | null;
  status: string | null;
  url: string | null;
  error: string | null;
  createdAt: string | null;
  loggedAt: string | null;
};
```

### `/admin/monitoring/pipeline/*`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/admin/monitoring/pipeline/health` | Readiness | Admin role | none | `{ ok; checks; timestamp }` |
| `GET` | `/admin/monitoring/pipeline/diagnostics` | Safe diagnostics | Admin role | none | diagnostics object, no secrets |
| `GET` | `/admin/monitoring/pipeline/events` | List events | Admin role | query `MonitoringEventsQueryDto` | `PipelineEvent[]` |
| `GET` | `/admin/monitoring/pipeline/summary` | Event summary | Admin role | query `{ hours?: number }` | summary object |

```ts
type MonitoringEventsQueryDto = {
  limit?: number;
  stage?: "IMAGE_GENERATION" | "RENDER" | "PUBLISH" | "TRACKING" | "CONVERSION";
  severity?: "INFO" | "WARN" | "ERROR";
  status?: string;
  jobId?: string;
  offerId?: string;
  clickId?: string;
  provider?: string;
  sinceHours?: number;
};
```

### `/admin/api-keys/*`

```ts
type IntegrationProvider = "GOOGLE" | "OPENAI" | "DIGISTORE" | "CLICKBANK" | "YOUTUBE" | "SHOTSTACK";
```

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/admin/api-keys` | List key metadata | Admin role | none | `Array<{ provider; masked; updatedAt; createdAt }>` |
| `PUT` | `/admin/api-keys/:provider` | Create/replace key | Admin role | `{ key: string }`, min 6 | `{ provider; masked; updatedAt }` |
| `DELETE` | `/admin/api-keys/:provider` | Delete key | Admin role | none | `{ ok: true }` |

### `/admin/platform/settings`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/admin/platform/settings` | Get settings | Admin role | none | app settings |
| `PATCH` | `/admin/platform/settings` | Update settings | Admin role | `UpdateSettingsDto` | app settings |
| `GET` | `/admin/platform/health` | Basic health/debug | Admin role | none | plain string |

```ts
type UpdateSettingsDto = {
  automationEnabled?: boolean;
  verticalEnabled?: boolean;
  autoPublish?: boolean;
  timezone?: string;
  videosPerDay?: number; // 1..3
  runHours?: number[];   // integers 0..23, non-empty
};
```

### `/admin/promo-codes/*`

Promo code management is admin-only. Codes are normalized to uppercase on create/update. Duplicate codes return `409`.

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/admin/promo-codes` | Create influencer promo code | Admin role | `CreatePromoCodeDto` | `PromoCode` |
| `GET` | `/admin/promo-codes` | List promo codes | Admin role | none | `PromoCode[]` |
| `GET` | `/admin/promo-codes/:id` | Get promo code | Admin role | UUID | `PromoCode` |
| `PATCH` | `/admin/promo-codes/:id` | Update promo code | Admin role | `UpdatePromoCodeDto` | `PromoCode` |
| `POST` | `/admin/promo-codes/:id/deactivate` | Deactivate promo code | Admin role | UUID | `PromoCode` |
| `POST` | `/admin/promo-codes/:id/reactivate` | Reactivate promo code | Admin role | UUID | `PromoCode` |
| `GET` | `/admin/promo-codes/:id/performance` | Promo attribution/revenue performance | Admin role | UUID | `PromoCodePerformance` |

```ts
type CreatePromoCodeDto = {
  code: string;
  influencerName: string;
  influencerEmail?: string;
  description?: string;
  discountType?: PromoDiscountType; // default NONE
  discountValue?: number;           // required when discountType is PERCENTAGE or FIXED
  appliesToPlans?: PromoAppliesToPlan; // default ALL
  maxRedemptions?: number;
  startsAt?: string;
  expiresAt?: string;
  isActive?: boolean; // default true
};

type UpdatePromoCodeDto = Partial<CreatePromoCodeDto>;

type PromoAttribution = {
  id: string;
  promoCodeId: string;
  userId: string;
  workspaceId: string | null;
  subscriptionId: string | null;
  provider: BillingProvider | null;
  plan: Plan | null;
  interval: "MONTHLY" | "YEARLY" | null;
  amount: number | null;   // provider minor amount when available
  currency: string | null; // uppercased when available
  status: PromoAttributionStatus;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; email: string; name: string | null };
  workspace?: { id: string; name: string };
};

type PromoCodePerformance = {
  promoCode: PromoCode;
  signups: number;
  checkoutStarts: number;
  successfulSubscriptions: number;
  conversionRate: number;
  revenueAttributed: number;
  revenueByProvider: Record<string, number>;
  revenueByPlan: Record<string, number>;
  latestRedemptions: PromoAttribution[];
};
```

### `/admin/users`, `/admin/workspaces/*`, `/admin/billing/workspaces/:workspaceId/subscription`

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/admin/users` | List SaaS users | Admin role | none | user list with counts |
| `GET` | `/admin/workspaces` | List SaaS workspaces | Admin role | none | workspace list with owner, subscription, counts |
| `GET` | `/admin/workspaces/:workspaceId/usage` | View workspace usage | Admin role | UUID | billing usage response |
| `POST` | `/admin/workspaces/:workspaceId/suspend` | Suspend workspace | Admin role | `{ reason?: string }`, max 500 | workspace row |
| `POST` | `/admin/workspaces/:workspaceId/unsuspend` | Unsuspend workspace | Admin role | none | workspace row |
| `GET` | `/admin/billing/workspaces/:workspaceId/subscription` | View subscription | Admin role | UUID | subscription response |
| `PATCH` | `/admin/billing/workspaces/:workspaceId/subscription` | Update subscription manually | Admin role | `UpdateSubscriptionDto` | subscription response |

```ts
type UpdateSubscriptionDto = {
  plan?: Plan;
  status?: SubscriptionStatus;
  billingProvider?: BillingProvider;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  trialEndsAt?: string;
};
```

## Other Customer Automation Routes

These remain workspace-scoped customer routes:

| Method | Path | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/automation/topics` | Create topic | `{ title: string; source?: string; score?: number }` | `Topic` |
| `GET` | `/automation/topics` | List topics | none | `Topic[]` |
| `GET` | `/automation/topics/pending` | Up to 5 pending topics | none | `Topic[]` |
| `PATCH` | `/automation/topics/:id/used` | Mark topic used | none | `Topic` |
| `POST` | `/automation/scripts` | Create reviewed script from content | `{ topicId: string; content: string }` | `Script` |
| `POST` | `/automation/scripts/ai` | Generate AI script | `{ topicId: string; topic: string }` | `Script` |
| `GET` | `/automation/scripts` | List scripts | none | `Script[]` |
| `GET` | `/automation/scripts/:id/thumbnail` | Script thumbnail metadata | none | thumbnail metadata |
| `POST` | `/automation/scripts/:id/thumbnail` | Generate script thumbnail | `{ prompt?: string }` | thumbnail metadata |
| `PATCH` | `/automation/scripts/:id/thumbnail` | Regenerate script thumbnail | `{ prompt?: string }` | thumbnail metadata |
| `GET` | `/automation/videos/:id/thumbnail` | Video thumbnail metadata | none | thumbnail metadata |
| `POST` | `/automation/videos/:id/thumbnail` | Generate video thumbnail | `{ prompt?: string }` | thumbnail metadata |
| `PATCH` | `/automation/videos/:id/thumbnail` | Regenerate video thumbnail | `{ prompt?: string }` | thumbnail metadata |

## Public Webhooks

Not frontend routes:

- `POST /billing/webhook`
- `POST /billing/webhook/:provider`
- `POST /webhooks/digistore24`
- `POST /webhooks/clickbank?key=:key`

Billing provider webhooks complete promo attribution: successful subscription events mark matching promo attribution rows `SUBSCRIBED`, attach subscription/payment metadata, and increment `PromoCode.redemptionCount`.

## Removed / Deprecated Frontend Route Usage

- Customer app must not call `/admin/*`.
- Customer app must not use old admin-only offer assumptions; `/offers` is now workspace-scoped customer API.
- Old `/settings` is gone; admin settings are `/admin/platform/settings`.
- Old `/automation/orchestrator/run` and `/automation/orchestrator/run-now` moved to `/admin/manual-ops/orchestrator/*`.
- Old `/automation/ingest` and `/automation/topics/seed` moved to `/admin/manual-ops/ingest` and `/admin/manual-ops/topics/seed`.
- Old `/monitoring/pipeline/*` moved to `/admin/monitoring/pipeline/*`.
- Old `/automation/workflow/status` moved to `/admin/workflow/status`.
- Old `/automation/jobs*` moved to `/admin/jobs*`.
- Old `POST /automation/videos` manual registration moved to `POST /admin/manual-ops/videos`.
- Customer render starts now use `POST /automation/videos/:scriptId`; admin/manual render remains `/admin/manual-ops/videos/:scriptId/render`.

## Frontend Migration Checklist

- Update customer auth helpers for signup, login, me, verify email, resend verification, forgot/reset password, refresh, logout, logout-all.
- Add optional `promoCode` support to signup and billing checkout forms.
- Add public promo validation with `POST /promo-codes/validate` on signup/pricing screens.
- Add admin auth helpers for `/admin/auth/login` and `/admin/auth/me`.
- Separate customer/admin sessions.
- Add `x-workspace-id` handling to customer API helpers.
- Update admin API paths to the new `/admin/*` routes.
- Add admin promo-code CRUD and performance pages under `/admin/promo-codes`.
- Remove old operator route usage from the customer app.
- Update customer and admin navigation.
- Update command palette commands to separate customer/admin destinations.
- Test customer wizard script generation, edit, review, video polling, assets, and publish.
- Test customer wizard render start with `POST /automation/videos/:scriptId`.
- Test admin console auth, workflow, manual ops, jobs, logs, monitoring, API keys, platform settings, users, workspaces, and billing.
