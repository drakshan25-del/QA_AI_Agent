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
exports.DocumentSegment = void 0;
const typeorm_1 = require("typeorm");
let DocumentSegment = class DocumentSegment {
};
exports.DocumentSegment = DocumentSegment;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], DocumentSegment.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'document_id' }),
    __metadata("design:type", String)
], DocumentSegment.prototype, "documentId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], DocumentSegment.prototype, "sequence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'page_or_sheet', default: '' }),
    __metadata("design:type", String)
], DocumentSegment.prototype, "pageOrSheet", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'row_or_section', default: '' }),
    __metadata("design:type", String)
], DocumentSegment.prototype, "rowOrSection", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], DocumentSegment.prototype, "content", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], DocumentSegment.prototype, "metadata", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'inclusion_status', default: 'included' }),
    __metadata("design:type", String)
], DocumentSegment.prototype, "inclusionStatus", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], DocumentSegment.prototype, "createdAt", void 0);
exports.DocumentSegment = DocumentSegment = __decorate([
    (0, typeorm_1.Entity)('document_segments')
], DocumentSegment);
//# sourceMappingURL=document-segment.entity.js.map