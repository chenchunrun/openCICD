import { Injectable } from '@nestjs/common';
import { HIGH_RISK_PATH_PATTERNS, matchGlob } from '@aicp/shared';

@Injectable()
export class HighRiskPathService {
  private readonly patterns = [...HIGH_RISK_PATH_PATTERNS];

  getDefaultHighRiskPaths(): string[] {
    return [...this.patterns];
  }

  isHighRisk(filePath: string): boolean {
    return this.patterns.some((pattern) => matchGlob(pattern, filePath));
  }

  filterHighRisk(filePaths: string[]): string[] {
    return filePaths.filter((p) => this.isHighRisk(p));
  }
}
