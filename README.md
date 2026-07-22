<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## AI Motion Phase 1

Standard video generation remains the production default. Older clients that omit
`generationMode` continue to create `STANDARD` jobs through the existing image,
Shotstack, narration, captions, tracking, and publishing pipeline.

AI Motion is a disabled-by-default backend foundation. It adds the
provider-independent API contract, Prisma metadata, eligibility checks,
deterministic scene planning, fake credit estimates, fake provider scaffolding,
fallback policy, idempotency keys, and hybrid image/video timeline validation.
It does not call a real AI-video provider and does not deduct or reserve credits.

Safe local defaults:

```bash
AI_MOTION_ENABLED=false
AI_MOTION_PROVIDER=fake
AI_MOTION_FAKE_PROVIDER_ENABLED=false
```

Focused AI Motion tests:

```bash
npx jest src/automation/videos/ai-motion-foundation.spec.ts src/automation/videos/ai-motion-orchestrator.service.spec.ts src/automation/videos/standard-video.mode.spec.ts src/automation/videos/videos.service.spec.ts --runInBand
```

## Reset Runbook Notes

After a database reset, create the first admin explicitly. Login does not auto-create admins.

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='change-me-now' npm run admin:create
```

`ADMIN_EMAIL` must be present in the comma-separated `ADMIN_EMAILS` allowlist.

Seed affiliate offers before running orchestration. Copy the example file, replace placeholder links/product IDs with real approved affiliate links, then run:

```bash
npm run offers:seed -- --file=data/offers.seed.json
```

Offer seed shape:

```json
[
  {
    "network": "digistore24",
    "externalProductId": "DIGISTORE_PRODUCT_ID",
    "name": "Example Digistore24 Sleep Offer",
    "nicheTag": "sleep",
    "hoplink": "https://www.digistore24.com/redir/example/product",
    "active": true
  },
  {
    "network": "clickbank",
    "name": "Example ClickBank Focus Offer",
    "nicheTag": "memory",
    "hoplink": "https://example.hop.clickbank.net",
    "active": true
  }
]
```

Supported networks are `digistore24` and `clickbank`. Supported niches are `sleep`, `weight-loss`, `energy`, `stress`, `gut-health`, `focus`, `fitness`, `hormones`, `memory`, `mens-health`, `dental-health`, `joint-health`, and `hearing-health`.

## YouTube OAuth

Production workspace YouTube connect uses global Google OAuth credentials. `YOUTUBE_REDIRECT_URI` is the primary workspace callback URL; `YOUTUBE_CUSTOMER_REDIRECT_URI` is only a legacy fallback when the global redirect is absent.

Required when YouTube publishing is enabled:

```bash
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=https://api.joinjubily.com/api/auth/youtube/callback
YOUTUBE_PUBLISHING_ENABLED=true
```

Add this exact authorized redirect URI in Google Cloud Console:

```text
https://api.joinjubily.com/api/auth/youtube/callback
```

The workspace connect endpoint is `POST /api/workspaces/:workspaceId/youtube/connect`. Google redirects back to the API callback, and the backend redirects the browser to `https://joinjubily.com/youtube?connected=true`.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
