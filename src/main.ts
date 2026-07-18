import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, type Request, urlencoded } from 'express';
import { AppModule } from './app.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';

export const allowedCorsOrigins = [
  'https://joinjubily.com',
  'https://www.joinjubily.com',
];

export function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) {
  if (!origin || allowedCorsOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error('Not allowed by CORS'));
}

type RawBodyRequest = Request & { rawBody?: Buffer };

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'r/:offerId', method: RequestMethod.GET }],
  });

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-workspace-id'],
  });

  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(urlencoded({ extended: false }));
  app.use(
    json({
      verify: (req: RawBodyRequest, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Jubily Automation Core API')
    .setDescription(
      'Backend API for authentication, automation, video jobs, publishing, tracking, webhooks, settings, and pipeline monitoring.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token returned by POST /api/auth/login.',
      },
      'jwt',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'query',
        name: 'key',
        description:
          'ClickBank INS shared secret query parameter for POST /api/webhooks/clickbank.',
      },
      'clickbank-key',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    jsonDocumentUrl: 'api-json',
    yamlDocumentUrl: 'api-yaml',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(Number(process.env.PORT) || 3000);
}

if (require.main === module) {
  void bootstrap();
}
