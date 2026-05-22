import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { ConfigModule } from '../../config/config.module.js';
import { RepoModule } from '../repo/repo.module.js';
import { ReviewModule } from '../review/review.module.js';
import { ReleaseController } from './release.controller.js';
import { ReleaseService } from './release.service.js';

@Module({
  imports: [AccessModule, ConfigModule, ReviewModule, RepoModule],
  controllers: [ReleaseController],
  providers: [ReleaseService],
  exports: [ReleaseService],
})
export class ReleaseModule {}
