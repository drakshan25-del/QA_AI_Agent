"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const configuration_1 = __importDefault(require("./config/configuration"));
const env_validation_1 = require("./config/env.validation");
const correlation_1 = require("./common/correlation");
const jwt_auth_guard_1 = require("./common/guards/jwt-auth.guard");
const database_module_1 = require("./database/database.module");
const engine_module_1 = require("./engine/engine.module");
const access_module_1 = require("./common/access/access.module");
const audit_module_1 = require("./modules/audit/audit.module");
const events_module_1 = require("./modules/events/events.module");
const notifications_module_1 = require("./modules/notifications/notifications.module");
const sequences_module_1 = require("./modules/sequences/sequences.module");
const retention_module_1 = require("./modules/retention/retention.module");
const jobs_module_1 = require("./modules/jobs/jobs.module");
const approvals_module_1 = require("./modules/approvals/approvals.module");
const auth_module_1 = require("./modules/auth/auth.module");
const projects_module_1 = require("./modules/projects/projects.module");
const documents_module_1 = require("./modules/documents/documents.module");
const requirements_module_1 = require("./modules/requirements/requirements.module");
const analysis_module_1 = require("./modules/analysis/analysis.module");
const test_plans_module_1 = require("./modules/test-plans/test-plans.module");
const test_cases_module_1 = require("./modules/test-cases/test-cases.module");
const automation_module_1 = require("./modules/automation/automation.module");
const executions_module_1 = require("./modules/executions/executions.module");
const findings_module_1 = require("./modules/findings/findings.module");
const reports_module_1 = require("./modules/reports/reports.module");
const git_module_1 = require("./modules/git/git.module");
const ci_module_1 = require("./modules/ci/ci.module");
const health_module_1 = require("./modules/health/health.module");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(correlation_1.CorrelationMiddleware).forRoutes('*');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                validate: env_validation_1.validateEnv,
                envFilePath: ['.env'],
                cache: true,
            }),
            database_module_1.DatabaseModule,
            engine_module_1.EngineModule,
            access_module_1.AccessModule,
            audit_module_1.AuditModule,
            events_module_1.EventsModule,
            notifications_module_1.NotificationsModule,
            sequences_module_1.SequencesModule,
            retention_module_1.RetentionModule,
            jobs_module_1.JobsModule,
            approvals_module_1.ApprovalsModule,
            auth_module_1.AuthModule,
            projects_module_1.ProjectsModule,
            documents_module_1.DocumentsModule,
            requirements_module_1.RequirementsModule,
            analysis_module_1.AnalysisModule,
            test_plans_module_1.TestPlansModule,
            test_cases_module_1.TestCasesModule,
            automation_module_1.AutomationModule,
            executions_module_1.ExecutionsModule,
            findings_module_1.FindingsModule,
            reports_module_1.ReportsModule,
            git_module_1.GitModule,
            ci_module_1.CiModule,
            health_module_1.HealthModule,
        ],
        providers: [
            { provide: core_1.APP_GUARD, useClass: jwt_auth_guard_1.JwtAuthGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map