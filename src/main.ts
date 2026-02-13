/* eslint-disable prettier/prettier */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Reflector } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ CORS (dev-friendly)
  app.enableCors({
    origin: true,        // reflect request origin (allows localhost + any)
    credentials: true,   // needed because you use withCredentials: true in axios
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector));

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  await app.listen(Number(process.env.PORT) || 3000);
}
bootstrap();
