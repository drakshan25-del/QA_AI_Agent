import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../../entities';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/** In-app notifications (FR-V3-ENT-007). Global so jobs/executions/CI can inject it. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
