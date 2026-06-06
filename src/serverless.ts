/**
 * Vercel serverless entry point.
 * Wraps NestJS in an Express adapter so Vercel can invoke it as a function.
 * The app is cached across warm invocations to avoid re-bootstrapping on every request.
 */
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import express from 'express';
import type { Request, Response } from 'express';

const expressApp = express();
let initialised = false;

async function bootstrap() {
  if (!initialised) {
    const app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(expressApp),
      { logger: ['warn', 'error'] },
    );

    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.enableCors();
    await app.init();
    initialised = true;
  }
}

// Vercel calls this export as the serverless handler
export default async function handler(req: Request, res: Response) {
  await bootstrap();
  expressApp(req, res);
}
