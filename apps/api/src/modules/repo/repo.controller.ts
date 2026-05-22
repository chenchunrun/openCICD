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

    const workflows = await this.workflowGenerator.inspectWorkflowDefinitions(repo.localPath);

    return {
      repoId: repo.id,
      repo: repo.fullName,
      localPath: repo.localPath ?? null,
      workflows,
    };
  }

  @Get(':id/workflows/:workflowName')
  async getWorkflowFile(
    @Param('id') id: string,
    @Param('workflowName') workflowName: string,
  ) {
    const repo = await this.repoService.findOne(id);
    if (!repo) {
      return null;
    }

    const workflows = this.workflowGenerator.generateWorkflowDefinitions();
    const workflow = workflows.find((entry) => entry.filename === workflowName);
    if (!workflow) {
      return null;
    }

    return {
      repoId: repo.id,
      repo: repo.fullName,
      workflowName,
      workflowPath: workflow.installPath,
      content: workflow.content,
    };
  }
}
