import { Injectable } from '@nestjs/common';
import type { TaskSourceType } from '@aicp/shared';

export interface NormalizedTask {
  goal: string;
  scope: { allowedPaths: string[]; forbiddenPaths: string[] };
  doneWhen: string[];
  constraints: string[];
  sourceType: TaskSourceType;
}

@Injectable()
export class TaskNormalizerService {
  normalizeFromGithubIssue(
    issue: { title: string; body?: string; labels?: Array<{ name: string }> },
    _repoFullName: string,
  ): NormalizedTask {
    const goal = issue.title;
    const body = issue.body ?? '';

    const labels = (issue.labels ?? []).map((l) => l.name.toLowerCase());
    const scope = this.inferScope(labels, body);

    return {
      goal,
      scope,
      doneWhen: this.inferDoneWhen(body),
      constraints: this.inferConstraints(body),
      sourceType: 'github_issue',
    };
  }

  normalizeFromCiFailure(
    failure: { jobName: string; logs: string; branch: string },
  ): NormalizedTask {
    return {
      goal: `Fix CI failure in ${failure.jobName}`,
      scope: {
        allowedPaths: this.inferPathsFromLogs(failure.logs),
        forbiddenPaths: ['infra/**', '.github/workflows/**'],
      },
      doneWhen: [
        `CI job ${failure.jobName} passes`,
        'No existing tests removed or weakened',
      ],
      constraints: [
        'Do not modify CI configuration to skip checks',
        'Do not delete failing tests',
      ],
      sourceType: 'ci_failure',
    };
  }

  private inferScope(
    labels: string[],
    body: string,
  ): { allowedPaths: string[]; forbiddenPaths: string[] } {
    const allowedPaths: string[] = [];
    const forbiddenPaths = ['infra/**', 'migrations/**', '.github/workflows/**'];

    const codeBlockMatch = body.match(/(?:files?|path|area|scope):\s*(.+)/i);
    if (codeBlockMatch) {
      allowedPaths.push(codeBlockMatch[1]!.trim());
    }

    if (labels.includes('bug')) {
      allowedPaths.push('src/**', 'tests/**');
    }

    if (allowedPaths.length === 0) {
      allowedPaths.push('src/**', 'tests/**');
    }

    return { allowedPaths, forbiddenPaths };
  }

  private inferDoneWhen(body: string): string[] {
    const doneWhen: string[] = [];

    const acceptMatch = body.match(/##?\s*(?:acceptance|done|criteria)([\s\S]*?)(?=\n##?\s|$)/i);
    if (acceptMatch) {
      const lines = acceptMatch[1]!.split('\n').filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'));
      for (const line of lines) {
        doneWhen.push(line.replace(/^[\s]*[-*]\s*/, '').trim());
      }
    }

    if (doneWhen.length === 0) {
      doneWhen.push('All existing tests pass', 'New code has test coverage');
    }

    return doneWhen;
  }

  private inferConstraints(body: string): string[] {
    const constraints: string[] = [];

    if (/no\s+new\s+dependencies/i.test(body)) {
      constraints.push('Do not introduce new dependencies');
    }

    if (/no\s+schema\s+change/i.test(body)) {
      constraints.push('Do not modify database schema');
    }

    return constraints;
  }

  private inferPathsFromLogs(logs: string): string[] {
    const fileMatches = logs.matchAll(/(?:at\s+)?(?:.*\/)?(src\/[^\s:]+|tests?\/[^\s:]+)/g);
    const paths = new Set<string>();

    for (const match of fileMatches) {
      const path = match[1];
      if (path) {
        const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) + '/**' : '';
        if (dir) paths.add(dir);
      }
    }

    return paths.size > 0 ? [...paths] : ['src/**', 'tests/**'];
  }
}
