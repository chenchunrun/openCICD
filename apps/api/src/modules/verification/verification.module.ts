import { Module } from '@nestjs/common';
import { CommandRunnerService } from './command-runner.service.js';
import { DependencyScanService } from './dependency-scan.service.js';
import { LicenseScanService } from './license-scan.service.js';
import { SecretScanService } from './secret-scan.service.js';
import { SastScanService } from './sast-scan.service.js';
import { VerificationService } from './verification.service.js';
import { TestSelectionService } from './test-selection.service.js';
import { TestWeakeningDetectorService } from './test-weakening-detector.service.js';

@Module({
  providers: [
    CommandRunnerService,
    SecretScanService,
    SastScanService,
    DependencyScanService,
    LicenseScanService,
    VerificationService,
    TestSelectionService,
    TestWeakeningDetectorService,
  ],
  exports: [
    CommandRunnerService,
    SecretScanService,
    SastScanService,
    DependencyScanService,
    LicenseScanService,
    VerificationService,
    TestSelectionService,
    TestWeakeningDetectorService,
  ],
})
export class VerificationModule {}
