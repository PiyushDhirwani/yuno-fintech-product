import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // All routes under /api prefix
  app.setGlobalPrefix('api');

  // Validate and transform incoming DTOs automatically
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,        // strip unknown fields
      forbidNonWhitelisted: false,
      transform: true,        // coerce types (e.g., string → number)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Allow browser dashboard and Postman to reach the API
  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`KofiMarket Payment Gateway running on http://localhost:${port}`);
  logger.log(`Dashboard UI:  http://localhost:${port}/`);
  logger.log(`API base:      http://localhost:${port}/api`);
}

bootstrap();
