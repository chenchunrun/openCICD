import { Module } from '@nestjs/common';
import { ContextBrokerService } from './context-broker.service.js';

@Module({
  providers: [ContextBrokerService],
  exports: [ContextBrokerService],
})
export class ContextModule {}
