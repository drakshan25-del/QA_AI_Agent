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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectMember = void 0;
const typeorm_1 = require("typeorm");
let ProjectMember = class ProjectMember {
};
exports.ProjectMember = ProjectMember;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ProjectMember.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], ProjectMember.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'user_id' }),
    __metadata("design:type", String)
], ProjectMember.prototype, "userId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_role', default: 'qa_engineer' }),
    __metadata("design:type", String)
], ProjectMember.prototype, "projectRole", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], ProjectMember.prototype, "createdAt", void 0);
exports.ProjectMember = ProjectMember = __decorate([
    (0, typeorm_1.Entity)('project_members'),
    (0, typeorm_1.Index)(['projectId', 'userId'], { unique: true })
], ProjectMember);
//# sourceMappingURL=project-member.entity.js.map