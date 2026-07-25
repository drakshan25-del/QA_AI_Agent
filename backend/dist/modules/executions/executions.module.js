"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const executions_service_1 = require("./executions.service");
const execution_logger_service_1 = require("./execution-logger.service");
const executions_controller_1 = require("./executions.controller");
let ExecutionsModule = class ExecutionsModule {
};
exports.ExecutionsModule = ExecutionsModule;
exports.ExecutionsModule = ExecutionsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                entities_1.ExecutionRun,
                entities_1.ExecutionEvent,
                entities_1.ExecutionLogEntry,
                entities_1.TestResult,
                entities_1.GeneratedArtifact,
                entities_1.Project,
            ]),
        ],
        controllers: [executions_controller_1.ExecutionsController, executions_controller_1.ProjectExecutionsController],
        providers: [executions_service_1.ExecutionsService, execution_logger_service_1.ExecutionLoggerService],
        exports: [executions_service_1.ExecutionsService, execution_logger_service_1.ExecutionLoggerService],
    })
], ExecutionsModule);
//# sourceMappingURL=executions.module.js.map