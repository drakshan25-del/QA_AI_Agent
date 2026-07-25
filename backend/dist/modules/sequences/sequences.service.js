"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SequencesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequencesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
let SequencesService = SequencesService_1 = class SequencesService {
    constructor(repo) {
        this.repo = repo;
    }
    async next(projectId, name, count = 1) {
        if (count < 1)
            throw new Error('count must be >= 1');
        for (let attempt = 0; attempt < SequencesService_1.MAX_ATTEMPTS; attempt++) {
            const row = await this.repo.findOne({ where: { projectId, name } });
            if (!row) {
                try {
                    await this.repo.insert({ projectId, name, nextValue: 1 + count });
                    return 1;
                }
                catch {
                    continue;
                }
            }
            const res = await this.repo.update({ id: row.id, nextValue: row.nextValue }, { nextValue: row.nextValue + count });
            if ((res.affected ?? 0) === 1)
                return row.nextValue;
        }
        throw new errors_1.ConflictAppException(`Could not reserve sequence ${name} for project ${projectId} after ` +
            `${SequencesService_1.MAX_ATTEMPTS} attempts.`, 'sequence_contention');
    }
    async raiseTo(projectId, name, minimum) {
        for (let attempt = 0; attempt < SequencesService_1.MAX_ATTEMPTS; attempt++) {
            const row = await this.repo.findOne({ where: { projectId, name } });
            if (!row) {
                try {
                    await this.repo.insert({ projectId, name, nextValue: minimum + 1 });
                    return;
                }
                catch {
                    continue;
                }
            }
            if (row.nextValue > minimum)
                return;
            const res = await this.repo.update({ id: row.id, nextValue: row.nextValue }, { nextValue: minimum + 1 });
            if ((res.affected ?? 0) === 1)
                return;
        }
    }
};
exports.SequencesService = SequencesService;
SequencesService.MAX_ATTEMPTS = 25;
exports.SequencesService = SequencesService = SequencesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.ProjectSequence)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], SequencesService);
//# sourceMappingURL=sequences.service.js.map