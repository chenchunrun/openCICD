import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`API server running on http://localhost:${port}`);
}

bootstrap();
