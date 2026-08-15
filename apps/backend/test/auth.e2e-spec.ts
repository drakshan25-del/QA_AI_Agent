import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v2');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in the seeded admin and returns an access token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v2/auth/login')
      .send({ email: 'admin@example.com', password: 'admin12345' })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('admin');
  });

  it('rejects bad credentials with the standard error contract', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v2/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong' })
      .expect(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('unauthorized');
    expect(res.body.error.correlationId).toBeDefined();
  });

  it('registers a user, logs in and returns the profile from /auth/me', async () => {
    await request(app.getHttpServer())
      .post('/api/v2/auth/register')
      .send({ email: 'qa1@example.com', password: 'password123', role: 'qa_engineer' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/v2/auth/login')
      .send({ email: 'qa1@example.com', password: 'password123' })
      .expect(200);
    const token = login.body.accessToken as string;

    const me = await request(app.getHttpServer())
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.email).toBe('qa1@example.com');
    expect(me.body.role).toBe('qa_engineer');
  });

  it('registers the configured superowner email as superowner regardless of requested role', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v2/auth/register')
      .send({ email: 'rakshandangol93@gmail.com', password: 'password123', role: 'qa_engineer' })
      .expect(201);
    expect(res.body.role).toBe('superowner');
  });

  it('rejects unauthenticated access to a protected route', async () => {
    await request(app.getHttpServer()).get('/api/v2/projects').expect(401);
  });
});
