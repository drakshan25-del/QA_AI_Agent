"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FindingsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const findings_service_1 = require("./findings.service");
const findings_controller_1 = require("./findings.controller");
let FindingsModule = class FindingsModule {
};
exports.FindingsModule = FindingsModule;
exports.FindingsModule = FindingsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([entities_1.Finding, entities_1.TestResult, entities_1.ExecutionRun])],
        controllers: [findings_controller_1.FindingsController],
        providers: [findings_service_1.FindingsService],
        exports: [findings_service_1.FindingsService],
    })
], FindingsModule);
//# sourceMappingURL=findings.module.js.map