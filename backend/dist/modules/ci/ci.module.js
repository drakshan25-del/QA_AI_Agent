"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CiModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const ci_service_1 = require("./ci.service");
const ci_controller_1 = require("./ci.controller");
let CiModule = class CiModule {
};
exports.CiModule = CiModule;
exports.CiModule = CiModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([entities_1.Project, entities_1.GeneratedArtifact, entities_1.ExecutionRun]),
        ],
        controllers: [ci_controller_1.CiController],
        providers: [ci_service_1.CiService],
        exports: [ci_service_1.CiService],
    })
], CiModule);
//# sourceMappingURL=ci.module.js.map