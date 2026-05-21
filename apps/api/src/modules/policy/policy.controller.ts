import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PolicyService } from './policy.service.js';
import { PolicyResolverService } from './policy-resolver.service.js';

@Controller('policies')
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly resolverService: PolicyResolverService,
  ) {}

  @Get()
  async listPolicies() {
    return this.policyService.findAll();
  }

  @Get('effective')
  async getEffectivePolicy(
    @Query('repoId') repoId: string,
    @Query('path') path?: string,
  ) {
    return this.resolverService.resolveEffectivePolicy(repoId, path);
  }

  @Post('validate')
  async validatePolicy(@Body() body: { repoId: string; policy: Record<string, unknown> }) {
    return this.resolverService.validatePolicy(body.policy);
  }

  @Post('simulate')
  async simulatePolicy(
    @Body() body: { repoId: string; path?: string; overrides: Record<string, unknown> },
  ) {
    return this.resolverService.simulatePolicy(body.repoId, body.path, body.overrides);
  }
}
