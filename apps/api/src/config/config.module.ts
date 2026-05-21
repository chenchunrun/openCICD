import { Module } from '@nestjs/common';
import { ConfigService } from './configuration.js';

@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
