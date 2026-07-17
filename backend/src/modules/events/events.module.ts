import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsService } from './events.service';
import { EventsGateway } from './events.gateway';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [EventsService, EventsGateway],
  exports: [EventsService],
})
export class EventsModule {}
