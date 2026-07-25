"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const requirements_module_1 = require("../requirements/requirements.module");
const analysis_service_1 = require("./analysis.service");
const analysis_controller_1 = require("./analysis.controller");
let AnalysisModule = class AnalysisModule {
};
exports.AnalysisModule = AnalysisModule;
exports.AnalysisModule = AnalysisModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([entities_1.Analysis, entities_1.Requirement, entities_1.GenerationRun, entities_1.Project]),
            requirements_module_1.RequirementsModule,
        ],
        controllers: [analysis_controller_1.AnalysisController],
        providers: [analysis_service_1.AnalysisService],
        exports: [analysis_service_1.AnalysisService],
    })
], AnalysisModule);
//# sourceMappingURL=analysis.module.js.map