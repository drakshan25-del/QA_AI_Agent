"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const app_module_1 = require("./app.module");
const all_exceptions_filter_1 = require("./common/all-exceptions.filter");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: false });
    const config = app.get(config_1.ConfigService);
    const logger = new common_1.Logger('Bootstrap');
    app.setGlobalPrefix('api/v2', { exclude: [] });
    app.use((0, cookie_parser_1.default)());
    app.enableCors({
        origin: config.get('corsOrigin'),
        credentials: true,
    });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    app.useGlobalFilters(new all_exceptions_filter_1.AllExceptionsFilter());
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('Agentic AI QA System V2 — Backend API')
        .setDescription('System-of-record REST API (/api/v2). V2_CONTRACT §2/§3.')
        .setVersion('2.0.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('api/docs', app, document);
    const port = config.get('port');
    await app.listen(port);
    logger.log(`Backend listening on http://localhost:${port} (prefix /api/v2)`);
    logger.log(`Swagger UI at http://localhost:${port}/api/docs`);
    logger.log(`DB driver: ${config.get('db').driver}`);
}
void bootstrap();
//# sourceMappingURL=main.js.map