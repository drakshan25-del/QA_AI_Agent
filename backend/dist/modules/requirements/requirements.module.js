"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequirementsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const requirements_service_1 = require("./requirements.service");
const requirement_derivation_service_1 = require("./requirement-derivation.service");
const requirements_controller_1 = require("./requirements.controller");
let RequirementsModule = class RequirementsModule {
};
exports.RequirementsModule = RequirementsModule;
exports.RequirementsModule = RequirementsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                entities_1.Requirement,
                entities_1.AuditEvent,
                entities_1.SourceDocument,
                entities_1.DocumentSegment,
            ]),
        ],
        controllers: [requirements_controller_1.RequirementsController],
        providers: [requirements_service_1.RequirementsService, requirement_derivation_service_1.RequirementDerivationService],
        exports: [requirements_service_1.RequirementsService, requirement_derivation_service_1.RequirementDerivationService],
    })
], RequirementsModule);
//# sourceMappingURL=requirements.module.js.map