import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { EvidenceService } from './evidence.service.js';

@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  private readonly supportedScanTypes = new Set([
    'secret_scan',
    'sast_scan',
    'dependency_scan',
    'license_scan',
  ]);

  private normalizeQueryList(value?: string | string[]): string[] | undefined {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
    return undefined;
  }

  private normalizeScanTypes(value?: string | string[]): string[] | undefined {
    const entries = this.normalizeQueryList(value);
    if (!entries?.length) {
      return undefined;
    }

    const normalized = entries.filter((entry) => this.supportedScanTypes.has(entry));
    return normalized.length > 0 ? normalized : undefined;
  }

  @Get()
  async listAll() {
    return this.evidenceService.listAll();
  }

  @Get('task/:taskId')
  async getByTask(@Param('taskId') taskId: string) {
    return this.evidenceService.getByTask(taskId);
  }

  @Get('run/:runId')
  async getByRun(@Param('runId') runId: string) {
    return this.evidenceService.getByRun(runId);
  }

  @Post('export')
  async export(@Body() body: { taskIds?: string[]; runIds?: string[] }) {
    return this.evidenceService.export(body.taskIds, body.runIds);
  }

  @Post('export/bundle')
  async exportBundle(
    @Body() body: {
      taskIds?: string[];
      runIds?: string[];
      scanFindingsOnly?: boolean;
      approvalPendingOnly?: boolean;
      scanTypes?: string[];
    },
  ) {
    return this.evidenceService.exportBundle({
      ...body,
      scanTypes: this.normalizeScanTypes(body.scanTypes),
    });
  }

  @Get('export/bundle')
  async exportBundleByQuery(
    @Query('taskIds') taskIds?: string | string[],
    @Query('runIds') runIds?: string | string[],
    @Query('scanFindingsOnly') scanFindingsOnly?: string,
    @Query('approvalPendingOnly') approvalPendingOnly?: string,
    @Query('scanTypes') scanTypes?: string | string[],
  ) {
    return this.evidenceService.exportBundle({
      taskIds: this.normalizeQueryList(taskIds),
      runIds: this.normalizeQueryList(runIds),
      scanFindingsOnly: scanFindingsOnly === '1' || scanFindingsOnly === 'true',
      approvalPendingOnly: approvalPendingOnly === '1' || approvalPendingOnly === 'true',
      scanTypes: this.normalizeScanTypes(scanTypes),
    });
  }
}
