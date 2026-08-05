import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { CorrelationMiddleware } from './common/correlation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { DatabaseModule } from './database/database.module';
import { EngineModule } from './engine/engine.module';
import { AccessModule } from './common/access/access.module';
import { AuditModule } from './modules/audit/audit.module';
import { EventsModule } from './modules/events/events.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SequencesModule } from './modules/sequences/sequences.module';
import { RetentionModule } from './modules/retention/retention.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RequirementsModule } from './modules/requirements/requirements.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { UiScannerModule } from './modules/ui-scanner/ui-scanner.module';
import { TestPlansModule } from './modules/test-plans/test-plans.module';
import { TestCasesModule } from './modules/test-cases/test-cases.module';
import { AutomationModule } from './modules/automation/automation.module';
import { ExecutionsModule } from './modules/executions/executions.module';
import { FindingsModule } from './modules/findings/findings.module';
import { ReportsModule } from './modules/reports/reports.module';
import { GitModule } from './modules/git/git.module';
import { CiModule } from './modules/ci/ci.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env'],
      cache: true,
    }),
    DatabaseModule,
    // Global infrastructure (engine client, access, audit, events, jobs, approvals)
    EngineModule,
    AccessModule,
    AuditModule,
    EventsModule,
    NotificationsModule,
    SequencesModule,
    RetentionModule,
    JobsModule,
    ApprovalsModule,
    // Feature modules (Appendix A)
    AuthModule,
    ProjectsModule,
    DocumentsModule,
    RequirementsModule,
    AnalysisModule,
    UiScannerModule,
    TestPlansModule,
    TestCasesModule,
    AutomationModule,
    ExecutionsModule,
    FindingsModule,
    ReportsModule,
    GitModule,
    CiModule,
    HealthModule,
  ],
  providers: [
    // JWT auth guard applied globally; @Public opts routes out (V2_CONTRACT §1).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
