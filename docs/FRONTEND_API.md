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

SHOTSTACK_BASE_URL=https://api.shotstack.io/edit/v1
TERMS_VERSION=terms-2026-07
PRIVACY_POLICY_VERSION=privacy-2026-07

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
- `SHOTSTACK_BASE_URL` should normally be the Shotstack edit API base (`https://api.shotstack.io/edit/v1`). If an environment includes `/render`, the backend normalizes it and still posts to exactly `/edit/v1/render`, never `/render/render`.
- `TERMS_VERSION` and `PRIVACY_POLICY_VERSION` are optional. When set, signup stores the current versions with the consent timestamps.
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

Provider error safety:

- Render, YouTube, Stripe, and Paystack provider failures are serialized before logging/returning messages.
- Frontend responses must not expect raw provider error objects, OAuth tokens, API keys, authorization headers, or webhook secrets.
- Show the backend `message`/`providerMessage`/`error` fields as user-facing diagnostics where documented, not raw nested provider payloads.

Shared enums:

```ts
type AdminRole = "SUPER_ADMIN" | "ADMIN" | "SUPPORT";
type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";
type Plan = "FREE" | "PRO" | "PREMIUM";
type SubscriptionStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "EXPIRED";
type BillingProvider = "PAYSTACK" | "STRIPE";
type BillingInterval = "monthly" | "yearly";
type PromoDiscountType = "PERCENTAGE" | "FIXED" | "NONE";
type PromoDiscountDuration = "ONE_TIME";
type PromoAppliesToPlan = "PRO" | "PREMIUM" | "ALL";
type PromoRegionScope = "ALL" | "GLOBAL" | "AFRICA" | "NIGERIA" | "CUSTOM_COUNTRIES";
type PaystackDiscountMode = "TRACKING_ONLY" | "ONE_TIME_AMOUNT_DISCOUNT" | "UNSUPPORTED";
type PromoAttributionStatus = "SIGNUP" | "CHECKOUT_STARTED" | "SUBSCRIBED" | "FAILED" | "CANCELLED";
type RunSlot = "MORNING" | "AFTERNOON" | "EVENING";
type VideoJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "FAILED_PERMANENT" | "FAILED_QUOTA" | "FAILED_PUBLISH" | "CANCELLED";
type ScriptReviewStatus = "PENDING" | "APPROVED" | "NEEDS_REVIEW" | "REJECTED";
type ThumbnailStatus = "PENDING" | "GENERATING" | "READY" | "FAILED";

type AffiliateNiche =
  | "HEALTH_WELLNESS"
  | "FINANCE"
  | "AI_SOFTWARE"
  | "TECHNOLOGY"
  | "BUSINESS"
  | "EDUCATION"
  | "FITNESS"
  | "BEAUTY"
  | "TRAVEL"
  | "GAMING"
  | "ECOMMERCE"
  | "REAL_ESTATE"
  | "PARENTING"
  | "PETS"
  | "PERSONAL_DEVELOPMENT"
  | "FOOD"
  | "FASHION"
  | "HOME_GARDEN"
  | "AUTOMOTIVE"
  | "DIY"
  | "RELATIONSHIPS"
  | "SPIRITUALITY"
  | "OTHER";

type AffiliatePlatform =
  | "CLICKBANK"
  | "DIGISTORE24"
  | "WARRIORPLUS"
  | "JVZOO"
  | "AMAZON_ASSOCIATES"
  | "TEMU"
  | "ALIEXPRESS"
  | "IMPACT"
  | "PARTNERSTACK"
  | "CJ_AFFILIATE"
  | "SHAREASALE"
  | "RAKUTEN"
  | "AWIN"
  | "FLEXOFFERS"
  | "AVANGATE"
  | "EBAY_PARTNER_NETWORK"
  | "SHOPIFY_COLLABS"
  | "CUSTOM";
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
{
  email: string;
  password: string; // min length 8
  name?: string;
  promoCode?: string;
  acceptedTerms: true;
  acceptedPrivacyPolicy: true;
}
```

Response:

```ts
{
  success: false;
  code: "EMAIL_NOT_VERIFIED";
  message: "Email verification required. Verification email sent.";
  requiresEmailVerification: true;
  emailVerified: false;
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: false;
    emailVerifiedAt: null;
    acceptedTermsAt: string;
    acceptedPrivacyPolicyAt: string;
  };
}
```

Consent behavior:

- Signup is rejected unless both `acceptedTerms === true` and `acceptedPrivacyPolicy === true`.
- Rejection returns `400` with message `You must accept the Terms of Service and Privacy Policy to create an account.`
- On success, the backend stores `acceptedTermsAt`, `acceptedPrivacyPolicyAt`, and any configured legal document versions.

Example consent error:

```json
{
  "statusCode": 400,
  "message": "You must accept the Terms of Service and Privacy Policy to create an account.",
  "error": "Bad Request"
}
```

Notes: sends verification email and does not issue tokens until email verification/login. Duplicate email returns `409`. If `promoCode` is sent, the backend normalizes it to uppercase, validates it, and records `SIGNUP` attribution against the new user/workspace without requiring payment.

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
    acceptedTermsAt: string | null;
    acceptedPrivacyPolicyAt: string | null;
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
{
  name: string;                       // min length 2
  slug?: string;
  countryCode: string;                // required ISO alpha-2, stored uppercase
  countryName: string;                // required display name
  affiliateNiches?: AffiliateNiche[]; // health is supported but not defaulted
  affiliatePlatforms?: AffiliatePlatform[];
  primaryAffiliateLink?: string;      // optional http(s) URL
  affiliateLinks?: Record<string, unknown> | unknown[];
  preferredContentTone?: string;
  preferredLanguage?: string;
  targetAudience?: string;
  contentGoal?: string;
}
```

Response:

```ts
{
  id: string;
  name: string;
  slug: string | null;
  countryCode: string;
  countryName: string;
  affiliateNiches: AffiliateNiche[];
  affiliatePlatforms: AffiliatePlatform[];
  primaryAffiliateLink: string; // "" when unset
  affiliateLinks: unknown;      // {} when unset
  preferredContentTone: string; // "" when unset
  preferredLanguage: string;    // "" when unset
  targetAudience: string;       // "" when unset
  contentGoal: string;          // "" when unset
  ownerId: string;
  suspended: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  updatedAt: string;
  members: Array<{ role: "OWNER" }>;
}
```

Notes: `slug` is normalized to lowercase kebab-case, max 80 chars. Country is required for new workspace onboarding and is later used for promo region targeting, billing provider defaults, and analytics. Legacy workspaces may still have `countryCode: null` until their profile is completed.

Example:

```json
{
  "name": "Creator Growth Lab",
  "countryCode": "US",
  "countryName": "United States",
  "affiliateNiches": ["AI_SOFTWARE", "BUSINESS"],
  "affiliatePlatforms": ["PARTNERSTACK", "AMAZON_ASSOCIATES"],
  "primaryAffiliateLink": "https://partner.example.com/demo",
  "preferredContentTone": "practical",
  "preferredLanguage": "en",
  "targetAudience": "solo founders comparing software",
  "contentGoal": "drive affiliate product trials"
}
```

### `GET /workspaces`

Auth: customer JWT.

Response:

```ts
Array<{
  id: string;
  name: string;
  slug: string | null;
  countryCode: string | null;
  countryName: string | null;
  affiliateNiches: AffiliateNiche[];
  affiliatePlatforms: AffiliatePlatform[];
  primaryAffiliateLink: string; // "" when unset
  affiliateLinks: unknown;      // {} when unset
  preferredContentTone: string; // "" when unset
  preferredLanguage: string;    // "" when unset
  targetAudience: string;       // "" when unset
  contentGoal: string;          // "" when unset
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
  role: WorkspaceRole;
}>
```

### `GET /workspaces/:workspaceId`

Auth: customer JWT and workspace membership.

Response: `{ id: string; role: WorkspaceRole }`

### `GET /workspaces/:workspaceId/profile`

Auth: customer JWT and workspace membership.

Response:

```ts
{
  id: string;
  name: string;
  slug: string | null;
  countryCode: string | null;
  countryName: string | null;
  affiliateNiches: AffiliateNiche[];
  affiliatePlatforms: AffiliatePlatform[];
  primaryAffiliateLink: string; // "" when unset
  affiliateLinks: unknown;      // {} when unset
  preferredContentTone: string; // "" when unset
  preferredLanguage: string;    // "" when unset
  targetAudience: string;       // "" when unset
  contentGoal: string;          // "" when unset
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### `PATCH /workspaces/:workspaceId/profile`

Auth: workspace `OWNER` or `ADMIN`.

Request: any subset of profile fields.

```ts
{
  countryCode?: string;
  countryName?: string;
  affiliateNiches?: AffiliateNiche[];
  affiliatePlatforms?: AffiliatePlatform[];
  primaryAffiliateLink?: string;
  affiliateLinks?: Record<string, unknown> | unknown[];
  preferredContentTone?: string;
  preferredLanguage?: string;
  targetAudience?: string;
  contentGoal?: string;
}
```

Response: same as `GET /workspaces/:workspaceId/profile`.

Profile responses are frontend-safe: optional affiliate UX fields are returned as empty strings or `{}` instead of `null`, and niche/platform arrays are always arrays.

Example:

```json
{
  "countryCode": "NG",
  "countryName": "Nigeria",
  "affiliateNiches": ["FINANCE", "AI_SOFTWARE"],
  "affiliatePlatforms": ["IMPACT", "PARTNERSTACK"],
  "affiliateLinks": {
    "IMPACT": "https://impact.example.com/demo",
    "PARTNERSTACK": "https://partnerstack.example.com/demo"
  },
  "preferredContentTone": "direct",
  "preferredLanguage": "en",
  "targetAudience": "freelancers comparing business tools",
  "contentGoal": "generate qualified affiliate clicks"
}
```

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
  thumbnailUrl: string | null;
  selectedChannelId: string | null;
  currentChannel: YoutubeChannelSummary | null;
  channels: YoutubeChannelSummary[];
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

type YoutubeChannelSummary = {
  id: string;
  title: string;
  thumbnail: string | null;
  customUrl: string | null;
  selected: boolean;
};
```

Workspace YouTube diagnostics always return `targetChannelId: null`, `channelMatchesTarget: null`, `legacyFilePresent: false`, and `legacyFileWriteFallbackEnabled: false`.

Channel selector behavior:

- If one channel is connected, `channels` contains one item and it has `selected: true`.
- If multiple channels are returned by YouTube, `channels` contains `{ id, title, thumbnail, customUrl, selected }` for each available channel; the first returned channel is currently selected.
- `currentChannel` mirrors the selected channel or is `null` when disconnected.
- OAuth access/refresh tokens are never returned. Fetch failures return `connected: false`, `channels: []`, and a sanitized `error`.

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

Supported networks/platforms:

```ts
type OfferNetwork = AffiliatePlatform;
```

Supported niches/categories:

```ts
type OfferNiche = AffiliateNiche;
```

Beginner-facing meanings:

- Affiliate link: `hoplink`, the product URL that receives viewer traffic.
- Network: `network`, the affiliate provider/platform. ClickBank tracking uses `tid`; Digistore24 uses `custom`; other networks use the stored affiliate link as-is unless platform-specific tracking is implemented.
- Niche/category: `nicheTag`, used for filtering and topic-offer matching.
- Product description: no backend field exists. Use `name`, `nicheTag`, workspace profile, and wizard `prompt` for positioning copy.

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

Notes:

- Creates/reuses a `Topic` with `source: "wizard"` and consumes one AI generation for billable workspaces.
- AI generation uses the offer plus workspace profile context: `nicheTag`, `network`, `hoplink`, `affiliateNiches`, `affiliatePlatforms`, `primaryAffiliateLink`, `targetAudience`, `preferredContentTone`, `preferredLanguage`, and `contentGoal`.
- The backend does not default to health, supplements, medical products, or wellness unless the selected offer/profile niche is `HEALTH_WELLNESS`.

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
- A FREE-plan workspace can create a video only while within its plan limit. If the plan limit is exhausted, the backend returns `409` with a clear plan/credits message and does not call Shotstack.
- Render provider failures are stored on the `VideoJob.error` field with a sanitized message. Frontend should show the returned Nest error message for immediate create failures and poll `GET /automation/videos/:id` for later render status.

Publishing metadata:

- YouTube title/description generation is affiliate-product oriented and may include the affiliate link, CTA, and platform note.
- When a tracking/affiliate link is inserted, the description includes:

```text
Disclosure: This video may contain affiliate links. We may earn a commission if you purchase through our link, at no extra cost to you.
```

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
- All promo discounts are one-time checkout discounts. Renewals continue at the normal subscription price.
- A user/workspace can only successfully redeem the same promo code once. Repeat paid redemption returns `400` with `This promo code has already been used on this account.`
- Stripe discount promo codes use `promoCode.stripePromotionCodeId`, managed in the admin API. Missing Stripe promotion-code configuration returns `400` with `This promo code is not configured for Stripe checkout yet.`
- Paystack behavior is controlled by `paystackDiscountMode`: `TRACKING_ONLY` records attribution without changing price, `ONE_TIME_AMOUNT_DISCOUNT` charges `finalAmount`, and `UNSUPPORTED` blocks discount checkout with `Paystack one-time subscription discounts are not yet supported.`
- `redemptionCount` increments only after a successful subscription webhook marks an attribution `SUBSCRIBED`.
- Region targeting is enforced by `countryCode`: `ALL` applies everywhere, `NIGERIA` only `NG`, `AFRICA` only African country codes, `GLOBAL` outside Africa, and `CUSTOM_COUNTRIES` only `allowedCountries`.
- `regionScope: "ALL"` does not require `countryCode`; `allowedCountries: []` is valid and does not block any country.
- Region-restricted scopes (`GLOBAL`, `AFRICA`, `NIGERIA`, `CUSTOM_COUNTRIES`) require a country at validation/checkout time.

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
  discountDuration: PromoDiscountDuration; // always ONE_TIME
  appliesToPlans: PromoAppliesToPlan;
  regionScope: PromoRegionScope;
  allowedCountries: string[]; // ISO alpha-2 country codes
  stripePromotionCodeId: string | null; // starts with promo_
  stripeCouponId: string | null;        // starts with coupon_
  stripeDiscountConfigured: boolean;    // derived by frontend as Boolean(stripePromotionCodeId)
  paystackDiscountMode: PaystackDiscountMode;
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
  provider?: "PAYSTACK" | "STRIPE";
  interval?: "monthly" | "yearly";
  countryCode?: string; // ISO alpha-2; used for regional targeting and pricing preview
}
```

Response:

```ts
{
  valid: true;
  code: string;
  influencerName: string;
  discountType: PromoDiscountType;
  discountValue: number | null;
  discountDuration: "ONE_TIME";
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: string;
  discountLabel: string;
  renewalAmount: number;
  renewalNotice: "Discount applies to this payment only. Renewals continue at the standard price.";
  regionScope: PromoRegionScope;
  allowedCountries: string[];
  appliesToPlans: PromoAppliesToPlan;
  planApplies: boolean;
  trackingOnly: boolean;
  stripeDiscountConfigured: boolean;
  paystackDiscountMode: PaystackDiscountMode;
  providerSupported: boolean;
  providerError: string | null;
}
```

Example validation response:

```json
{
  "valid": true,
  "code": "BLACKFRIDAY50",
  "discountType": "PERCENTAGE",
  "discountValue": 50,
  "discountDuration": "ONE_TIME",
  "originalAmount": 2000000,
  "discountAmount": 1000000,
  "finalAmount": 1000000,
  "currency": "NGN",
  "discountLabel": "50% off",
  "renewalAmount": 2000000,
  "renewalNotice": "Discount applies to this payment only. Renewals continue at the standard price.",
  "regionScope": "NIGERIA",
  "allowedCountries": ["NG"],
  "stripeDiscountConfigured": false,
  "paystackDiscountMode": "ONE_TIME_AMOUNT_DISCOUNT",
  "providerSupported": true,
  "providerError": null
}
```

Region validation examples:

| Scope | `allowedCountries` | `countryCode` examples | Result |
| --- | --- | --- | --- |
| `ALL` | `[]` | omitted, `NG`, `US` | valid |
| `CUSTOM_COUNTRIES` | `[]` | any | admin create/update and public validation fail |
| `CUSTOM_COUNTRIES` | `["US", "CA"]` | `US`, `CA` | valid |
| `CUSTOM_COUNTRIES` | `["US", "CA"]` | `GB`, omitted | invalid |
| `NIGERIA` | any | `NG` | valid |
| `NIGERIA` | any | `US`, omitted | invalid |
| `AFRICA` | any | `NG`, `GH`, `KE` | valid |
| `AFRICA` | any | `US`, `GB`, omitted | invalid |
| `GLOBAL` | any | `US`, `GB` | valid |
| `GLOBAL` | any | `NG`, `GH`, `KE`, omitted | invalid |

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
  country?: string;                // optional override; otherwise stored workspace countryCode is used
  promoCode?: string;              // optional; normalized and validated server-side
}
```

Provider selection:

- Explicit provider must be `PAYSTACK` or `STRIPE`.
- Omitted provider selects from `country || workspace.countryCode`: `PAYSTACK` for `NG`, `GH`, `ZA`, `KE`, `CI`, `EG`, `RW`; otherwise `STRIPE`.
- Promo region validation and checkout attribution use the same country value. Do not rely on IP for checkout country.

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
    discountDuration: PromoDiscountDuration;
    originalAmount: number;
    discountAmount: number;
    finalAmount: number;
    renewalAmount: number;
    currency: string;
  };
}
```

Promo behavior:

- Invalid, inactive, expired, over-limit, plan-inapplicable, region-inapplicable, or already-used promo codes return `400`.
- Checkout records `CHECKOUT_STARTED` attribution before provider checkout is created.
- If the checkout request omits `country`, the backend uses the stored workspace `countryCode` for promo validation and analytics.
- `regionScope: "ALL"` still validates when the resolved country is missing.
- Stripe checkout metadata and subscription metadata include promo attribution fields. Discount promos require backend promotion-code mapping.
- Paystack checkout metadata includes promo attribution fields. `TRACKING_ONLY` codes do not reduce price, `ONE_TIME_AMOUNT_DISCOUNT` sends `finalAmount`, and `UNSUPPORTED` discount codes return the friendly unsupported error instead of silently charging full price.
- For all discount promos, `renewalAmount` is the standard subscription price after the one-time checkout payment.

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

Promo code management is admin-only. Codes are normalized to uppercase on create/update. Duplicate codes return `409` with `Promo code "<CODE>" already exists`.

Required on create: `code` and `influencerName`.

Defaulted on create when omitted: `discountType: "NONE"`, `discountDuration: "ONE_TIME"`, `appliesToPlans: "ALL"`, `regionScope: "ALL"`, `allowedCountries: []`, `isActive: true`, and `paystackDiscountMode: "TRACKING_ONLY"` for tracking-only codes or `"UNSUPPORTED"` for discount codes.

| Method | Path | Purpose | Role | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/admin/promo-codes` | Create influencer promo code | Admin role | `CreatePromoCodeDto` | `PromoCode` |
| `GET` | `/admin/promo-codes` | List promo codes | Admin role | none | `PromoCode[]` |
| `GET` | `/admin/promo-codes/:id` | Get promo code | Admin role | UUID | `PromoCode` |
| `PATCH` | `/admin/promo-codes/:id` | Update promo code | Admin role | `UpdatePromoCodeDto` | `PromoCode` |
| `DELETE` | `/admin/promo-codes/:id` | Delete promo code | Admin role | UUID | `PromoCode` |
| `POST` | `/admin/promo-codes/:id/deactivate` | Deactivate promo code | Admin role | UUID | `PromoCode` |
| `POST` | `/admin/promo-codes/:id/reactivate` | Reactivate promo code | Admin role | UUID | `PromoCode` |
| `GET` | `/admin/promo-codes/:id/performance` | Promo attribution/revenue performance | Admin role | UUID | `PromoCodePerformance` |

```ts
type CreatePromoCodeDto = {
  code: string;                    // required, trimmed and uppercased
  influencerName: string;          // required
  influencerEmail?: string;
  description?: string;
  discountType?: PromoDiscountType; // default NONE
  discountValue?: number;           // required when discountType is PERCENTAGE or FIXED
  discountDuration?: PromoDiscountDuration; // default ONE_TIME; only ONE_TIME is accepted
  appliesToPlans?: PromoAppliesToPlan; // default ALL
  regionScope?: PromoRegionScope;       // default ALL
  allowedCountries?: string[];          // ISO 3166-1 alpha-2; required for CUSTOM_COUNTRIES
  stripePromotionCodeId?: string;       // must start with promo_
  stripeCouponId?: string;              // must start with coupon_
  paystackDiscountMode?: PaystackDiscountMode; // default TRACKING_ONLY when discountType is NONE, otherwise UNSUPPORTED
  maxRedemptions?: number;
  startsAt?: string;
  expiresAt?: string;
  isActive?: boolean; // default true
};

type UpdatePromoCodeDto = Partial<CreatePromoCodeDto>;
```

Patch requests may include any subset of `CreatePromoCodeDto`. When changing `discountType` from `NONE` to `PERCENTAGE` or `FIXED`, include `discountValue` unless the existing promo already has one. When changing `regionScope` to `CUSTOM_COUNTRIES`, include at least one ISO alpha-2 country in `allowedCountries`.

Admin region rules:

- `ALL` may use `allowedCountries: []`; this means all countries and no country value are allowed.
- `CUSTOM_COUNTRIES` must include at least one ISO alpha-2 country.
- `NIGERIA`, `AFRICA`, and `GLOBAL` do not require `allowedCountries`; validation is based on `countryCode`.

Validation errors are returned as `400` unless noted:

```json
{ "statusCode": 400, "message": "discountValue is required for discount promo codes", "error": "Bad Request" }
```

Important admin validation messages:

- Duplicate code: `409` with `Promo code "<CODE>" already exists`
- Invalid or unsupported `discountDuration`: `discountDuration must be ONE_TIME`
- Invalid `regionScope`: `regionScope must be ALL, GLOBAL, AFRICA, NIGERIA, or CUSTOM_COUNTRIES`
- Invalid `allowedCountries`: `allowedCountries must contain only ISO 3166-1 alpha-2 country codes`
- Empty custom country scope: `allowedCountries is required when regionScope is CUSTOM_COUNTRIES`
- Invalid `paystackDiscountMode`: `paystackDiscountMode must be TRACKING_ONLY, ONE_TIME_AMOUNT_DISCOUNT, or UNSUPPORTED`
- Invalid `stripePromotionCodeId`: `stripePromotionCodeId must start with "promo_"`
- Invalid `stripeCouponId`: `stripeCouponId must start with "coupon_"`
- Missing discount value for discount promos: `discountValue is required for discount promo codes`

Example tracking-only create payload:

```json
{
  "code": "JANE",
  "influencerName": "Jane Creator"
}
```

Creates the same persisted defaults as:

```json
{
  "code": "JANE",
  "influencerName": "Jane Creator",
  "discountType": "NONE",
  "discountValue": null,
  "discountDuration": "ONE_TIME",
  "appliesToPlans": "ALL",
  "regionScope": "ALL",
  "allowedCountries": [],
  "paystackDiscountMode": "TRACKING_ONLY",
  "isActive": true
}
```

Example discount create payload:

```json
{
  "code": "BLACKFRIDAY50",
  "influencerName": "Black Friday Campaign",
  "discountType": "PERCENTAGE",
  "discountValue": 50,
  "discountDuration": "ONE_TIME",
  "appliesToPlans": "ALL",
  "regionScope": "NIGERIA",
  "allowedCountries": ["NG"],
  "stripePromotionCodeId": "promo_123",
  "stripeCouponId": "coupon_123",
  "paystackDiscountMode": "ONE_TIME_AMOUNT_DISCOUNT",
  "expiresAt": "2026-12-01T00:00:00.000Z"
}
```

Example update payload:

```json
{
  "discountType": "FIXED",
  "discountValue": 500,
  "regionScope": "CUSTOM_COUNTRIES",
  "allowedCountries": ["US", "CA"],
  "stripePromotionCodeId": "promo_456",
  "stripeCouponId": "coupon_456",
  "paystackDiscountMode": "TRACKING_ONLY",
  "isActive": true
}
```

Provider setup notes:

- Create the actual Stripe coupon/promotion code in Stripe, then paste the Stripe promotion code id into `stripePromotionCodeId`.
- The backend no longer reads `STRIPE_PROMO_<CODE>_PROMOTION_CODE_ID` environment variables.
- Paystack discount promos should use `UNSUPPORTED` unless the admin deliberately enables `TRACKING_ONLY` or `ONE_TIME_AMOUNT_DISCOUNT`.
- `TRACKING_ONLY` discount promos can attribute signups/checkouts but do not reduce the payment amount.

```ts

type PromoAttribution = {
  id: string;
  promoCodeId: string;
  userId: string;
  workspaceId: string | null;
  subscriptionId: string | null;
  provider: BillingProvider | null;
  plan: Plan | null;
  interval: "MONTHLY" | "YEARLY" | null;
  amount: number | null;         // provider minor amount when available
  originalAmount: number | null; // standard checkout amount before promo
  discountAmount: number | null;
  finalAmount: number | null;    // amount charged for this checkout
  renewalAmount: number | null;  // normal renewal amount after one-time discount
  currency: string | null; // uppercased when available
  countryCode: string | null;
  regionScope: PromoRegionScope | null;
  discountDuration: PromoDiscountDuration | null;
  redeemedAt: string | null;
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
  revenueBeforeDiscount: number;
  revenueAfterDiscount: number;
  discountTotal: number;
  discountGiven: number;
  stripeConfigured: {
    configured: boolean;
    count: 0 | 1;
  };
  paystackDiscountMode: PaystackDiscountMode;
  revenueByProvider: Record<string, number>;
  revenueByPlan: Record<string, number>;
  redemptionUniqueness: {
    uniqueUsers: number;
    uniqueWorkspaces: number;
  };
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
