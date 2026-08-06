import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Base path for all REST routes (V2_CONTRACT §2).
  app.setGlobalPrefix('api/v2', { exclude: [] });

  app.use(cookieParser());

  // CORS from env (browser is the only client, FR-FE-004).
  app.enableCors({
    origin: config.get<string>('corsOrigin'),
    credentials: true,
  });

  // Global validation (whitelist strips unknown props; transform coerces types).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Standard error contract (FR-BE-001).
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger API docs at /api/docs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Agentic AI QA System V2 — Backend API')
    .setDescription('System-of-record REST API (/api/v2). V2_CONTRACT §2/§3.')
    .setVersion('2.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<AppConfig['port']>('port')!;
  await app.listen(port);
  logger.log(`Backend listening on http://localhost:${port} (prefix /api/v2)`);
  logger.log(`Swagger UI at http://localhost:${port}/api/docs`);
  logger.log(`DB driver: ${config.get<AppConfig['db']>('db')!.driver}`);
}

void bootstrap();
