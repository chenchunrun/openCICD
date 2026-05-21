import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { RepoService } from './repo.service.js';
import { RepoOnboardingService } from './repo-onboarding.service.js';
import { OnboardRepoDto } from './dto/onboard-repo.dto.js';
import { WorkflowGeneratorService } from './workflow-generator.service.js';

@Controller('repos')
export class RepoController {
  constructor(
    private readonly repoService: RepoService,
    private readonly onboardingService: RepoOnboardingService,
    private readonly workflowGenerator: WorkflowGeneratorService,
  ) {}

  @Post()
  async onboard(@Body() body: OnboardRepoDto) {
    return this.onboardingService.onboard(body);
  }

  @Get()
  async findAll() {
    return this.repoService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.repoService.findOne(id);
  }

  @Get(':id/workflows')
  async getWorkflows(@Param('id') id: string) {
    const repo = await this.repoService.findOne(id);
    if (!repo) {
      return null;
    }

    return {
      repoId: repo.id,
      repo: repo.fullName,
      workflows: this.workflowGenerator.generateAllWorkflows(),
    };
  }
}
