import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '../entities';
import { AppConfig } from '../config/configuration';

/**
 * TypeORM driver switch (§5). `DB_DRIVER=postgres` uses pg + DATABASE_URL;
 * `DB_DRIVER=sqlite` uses better-sqlite3 with a local file (dev fallback, no
 * Docker). synchronize:true is used in dev so the schema is created on boot.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        const db = config.get<AppConfig['db']>('db')!;
        const common = {
          entities: ALL_ENTITIES,
          synchronize: true,
          autoLoadEntities: false,
        };
        if (db.driver === 'postgres') {
          return {
            type: 'postgres',
            url: db.url,
            ...common,
          };
        }
        return {
          type: 'better-sqlite3',
          database: db.sqliteFile,
          ...common,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
