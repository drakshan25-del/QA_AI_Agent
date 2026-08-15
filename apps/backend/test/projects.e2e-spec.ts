import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

describe('Projects + approval gate (e2e)', () => {
  let app: INestApplication;
  let token: string;

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

    const login = await request(app.getHttpServer())
      .post('/api/v2/auth/login')
      .send({ email: 'admin@example.com', password: 'admin12345' })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a project and lists it for the creator', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v2/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Demo Project', baseUrl: 'http://localhost:8001' })
      .expect(201);
    expect(created.body.id).toBeDefined();
    expect(created.body.name).toBe('Demo Project');

    const list = await request(app.getHttpServer())
      .get('/api/v2/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((p: { id: string }) => p.id === created.body.id)).toBe(
      true,
    );

    const one = await request(app.getHttpServer())
      .get(`/api/v2/projects/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(one.body.workflowSummary).toBeDefined();
  });

  it('rejects executing unapproved/absent automation with 409 or 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v2/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Gate Project' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v2/executions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: created.body.id,
        automationIds: ['00000000-0000-0000-0000-000000000000'],
      });
    // Non-existent artifact → 404; unapproved existing artifact → 409.
    expect([404, 409]).toContain(res.status);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.correlationId).toBeDefined();
  });
});
