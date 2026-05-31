/* eslint-disable prettier/prettier */
import 'dotenv/config'; // <-- add this first
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ CORS (dev-friendly)
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || ['https://joinjubily.com', 'https://www.joinjubily.com'].includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
  app.use(json());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Jubily Automation Core API')
    .setDescription('Backend API for authentication, automation, video jobs, publishing, tracking, webhooks, settings, and pipeline monitoring.')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token returned by POST /auth/login.',
      },
      'jwt',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'query',
        name: 'key',
        description: 'ClickBank INS shared secret query parameter for POST /webhooks/clickbank.',
      },
      'clickbank-key',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument, {
    jsonDocumentUrl: 'api-json',
    yamlDocumentUrl: 'api-yaml',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.listen(Number(process.env.PORT) || 3000);
}
void bootstrap();
