import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutionRun } from '../../entities';
import { EventsService } from './events.service';
import { EventsGateway } from './events.gateway';

@Global()
@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([ExecutionRun])],
  providers: [EventsService, EventsGateway],
  exports: [EventsService],
})
export class EventsModule {}
