"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestCasesModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const requirements_module_1 = require("../requirements/requirements.module");
const test_cases_service_1 = require("./test-cases.service");
const test_cases_controller_1 = require("./test-cases.controller");
let TestCasesModule = class TestCasesModule {
};
exports.TestCasesModule = TestCasesModule;
exports.TestCasesModule = TestCasesModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                entities_1.TestCase,
                entities_1.Requirement,
                entities_1.Analysis,
                entities_1.GenerationRun,
                entities_1.Project,
            ]),
            requirements_module_1.RequirementsModule,
        ],
        controllers: [test_cases_controller_1.TestCasesController],
        providers: [test_cases_service_1.TestCasesService],
        exports: [test_cases_service_1.TestCasesService],
    })
], TestCasesModule);
//# sourceMappingURL=test-cases.module.js.map