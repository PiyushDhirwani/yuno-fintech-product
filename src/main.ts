import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableCors();

  // Serve dashboard UI at / (local dev only — Vercel CDN handles this in production)
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/' });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`KofiMarket Payment Gateway running on http://localhost:${port}`);
  logger.log(`Dashboard UI:  http://localhost:${port}/`);
  logger.log(`API base:      http://localhost:${port}/api`);
}

bootstrap();
