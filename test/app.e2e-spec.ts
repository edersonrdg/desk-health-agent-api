import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { REDIS_CLIENT } from './../src/shared/redis/redis.constants';

/** Postgres and Redis connect in the background after boot (spec 002 D8). */
async function waitForConnections(moduleRef: TestingModule, timeoutMs = 5_000) {
  const dataSource = moduleRef.get(DataSource);
  const redis = moduleRef.get<Redis>(REDIS_CLIENT);
  const deadline = Date.now() + timeoutMs;
  while (
    !(dataSource.isInitialized && redis.status === 'ready') &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await waitForConnections(moduleFixture);
  });

  it('/health (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.text).toBe('');
  });

  // Needs `docker compose up -d` and a `.env` (see .env.example).
  it('/health/ready (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      details: { postgres: 'up', redis: 'up' },
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
