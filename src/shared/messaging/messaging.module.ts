import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxMessageEntity } from './inbox-message.entity';
import { OutboxMessageEntity } from './outbox-message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InboxMessageEntity, OutboxMessageEntity]),
  ],
  exports: [TypeOrmModule],
})
export class MessagingModule {}
