import { Injectable } from '@nestjs/common';

export interface LanguageStack {
  languages: string[];
  packageManager?: string;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
}

type ScriptName = 'test' | 'lint' | 'typecheck' | 'build';

const STACK_RULES: Record<string, Partial<LanguageStack>> = {
  'package.json': {
    languages: ['typescript'],
    packageManager: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    typecheckCommand: 'npm run typecheck',
    buildCommand: 'npm run build',
  },
  'package-lock.json': {
    languages: ['typescript'],
    packageManager: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    typecheckCommand: 'npm run typecheck',
    buildCommand: 'npm run build',
  },
  'pnpm-lock.yaml': {
    languages: ['typescript'],
    packageManager: 'pnpm',
    testCommand: 'pnpm test',
    lintCommand: 'pnpm lint',
    typecheckCommand: 'pnpm typecheck',
    buildCommand: 'pnpm build',
  },
  'yarn.lock': {
    languages: ['typescript'],
    packageManager: 'yarn',
    testCommand: 'yarn test',
    lintCommand: 'yarn lint',
    typecheckCommand: 'yarn typecheck',
    buildCommand: 'yarn build',
  },
  'bun.lockb': {
    languages: ['typescript'],
    packageManager: 'bun',
    testCommand: 'bun test',
    lintCommand: 'bun run lint',
    typecheckCommand: 'bun run typecheck',
    buildCommand: 'bun run build',
  },
  'requirements.txt': {
    languages: ['python'],
    packageManager: 'pip',
    testCommand: 'pytest',
    lintCommand: 'ruff check .',
  },
  'pyproject.toml': {
    languages: ['python'],
    packageManager: 'pip',
    testCommand: 'pytest',
    lintCommand: 'ruff check .',
    buildCommand: 'python -m build',
  },
  'uv.lock': {
    languages: ['python'],
    packageManager: 'uv',
    testCommand: 'uv run pytest',
    lintCommand: 'uv run ruff check .',
    buildCommand: 'uv build',
  },
  'poetry.lock': {
    languages: ['python'],
    packageManager: 'poetry',
    testCommand: 'poetry run pytest',
    lintCommand: 'poetry run ruff check .',
    buildCommand: 'poetry build',
  },
  'go.mod': {
    languages: ['go'],
    packageManager: 'go modules',
    testCommand: 'go test ./...',
    buildCommand: 'go build ./...',
  },
  'pom.xml': {
    languages: ['java'],
    packageManager: 'maven',
    testCommand: 'mvn test',
    buildCommand: 'mvn package',
  },
  'build.gradle': {
    languages: ['java'],
    packageManager: 'gradle',
    testCommand: './gradlew test',
    buildCommand: './gradlew build',
  },
  'Cargo.toml': {
    languages: ['rust'],
    packageManager: 'cargo',
    testCommand: 'cargo test',
    buildCommand: 'cargo build',
  },
  'composer.json': {
    languages: ['php'],
    packageManager: 'composer',
    testCommand: 'composer test',
    lintCommand: 'composer lint',
    buildCommand: 'composer build',
  },
  Gemfile: {
    languages: ['ruby'],
    packageManager: 'bundler',
    testCommand: 'bundle exec rspec',
    lintCommand: 'bundle exec rubocop',
  },
};

@Injectable()
export class LanguageDetectorService {
  detectFromFiles(files: string[]): LanguageStack {
    return this.detectFromProject(files);
  }

  detectFromProject(files: string[], fileContents: Record<string, string> = {}): LanguageStack {
    const result: LanguageStack = { languages: [] };

    for (const file of files) {
      const rule = STACK_RULES[file];
      if (!rule) {
        continue;
      }

      this.mergeStack(result, rule);
    }

    if (files.includes('tsconfig.json')) {
      this.pushLanguage(result, 'typescript');
    }

    if (fileContents['package.json']) {
      this.applyPackageJsonMetadata(result, fileContents['package.json']);
    }

    if (fileContents['pyproject.toml']) {
      this.applyPyprojectMetadata(result, fileContents['pyproject.toml']);
    }

    return result;
  }

  detectDefault(): LanguageStack {
    return { languages: ['unknown'] };
  }

  private mergeStack(result: LanguageStack, rule: Partial<LanguageStack>): void {
    if (rule.languages) {
      for (const language of rule.languages) {
        this.pushLanguage(result, language);
      }
    }

    if (rule.packageManager && !result.packageManager) {
      result.packageManager = rule.packageManager;
    }
    if (rule.testCommand && !result.testCommand) {
      result.testCommand = rule.testCommand;
    }
    if (rule.lintCommand && !result.lintCommand) {
      result.lintCommand = rule.lintCommand;
    }
    if (rule.typecheckCommand && !result.typecheckCommand) {
      result.typecheckCommand = rule.typecheckCommand;
    }
    if (rule.buildCommand && !result.buildCommand) {
      result.buildCommand = rule.buildCommand;
    }
  }

  private pushLanguage(result: LanguageStack, language: string): void {
    if (!result.languages.includes(language)) {
      result.languages.push(language);
    }
  }

  private applyPackageJsonMetadata(result: LanguageStack, rawPackageJson: string): void {
    try {
      const packageJson = JSON.parse(rawPackageJson) as {
        scripts?: Record<string, string>;
        packageManager?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const scripts = packageJson.scripts ?? {};
      const packageManager = this.detectNodePackageManager(packageJson.packageManager, result.packageManager);
      if (packageManager) {
        result.packageManager = packageManager;
      }

      const allDeps = {
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {}),
      };
      if (allDeps.typescript || allDeps['ts-node'] || allDeps.tsx) {
        this.pushLanguage(result, 'typescript');
      }

      result.testCommand = this.resolveNodeScriptCommand(packageManager, scripts, 'test');
      result.lintCommand = this.resolveNodeScriptCommand(packageManager, scripts, 'lint');
      result.typecheckCommand = this.resolveNodeScriptCommand(packageManager, scripts, 'typecheck');
      result.buildCommand = this.resolveNodeScriptCommand(packageManager, scripts, 'build');
    } catch {
      // Fall back to file-name heuristics when package.json cannot be parsed.
    }
  }

  private applyPyprojectMetadata(result: LanguageStack, rawPyproject: string): void {
    const content = rawPyproject.toLowerCase();

    if (content.includes('[tool.uv')) {
      result.packageManager = 'uv';
      result.testCommand = 'uv run pytest';
      result.lintCommand = 'uv run ruff check .';
      result.buildCommand = 'uv build';
      return;
    }

    if (content.includes('[tool.poetry')) {
      result.packageManager = 'poetry';
      result.testCommand = 'poetry run pytest';
      result.lintCommand = 'poetry run ruff check .';
      result.buildCommand = 'poetry build';
    }
  }

  private detectNodePackageManager(rawPackageManager: string | undefined, current: string | undefined): string {
    const normalized = rawPackageManager?.split('@')[0];
    if (normalized === 'pnpm' || normalized === 'npm' || normalized === 'yarn' || normalized === 'bun') {
      return normalized;
    }

    return current ?? 'npm';
  }

  private resolveNodeScriptCommand(
    packageManager: string | undefined,
    scripts: Record<string, string>,
    scriptName: ScriptName,
  ): string | undefined {
    if (!scripts[scriptName]) {
      return undefined;
    }

    switch (packageManager) {
      case 'pnpm':
        return scriptName === 'test' ? 'pnpm test' : `pnpm ${scriptName}`;
      case 'yarn':
        return scriptName === 'test' ? 'yarn test' : `yarn ${scriptName}`;
      case 'bun':
        return scriptName === 'test' ? 'bun test' : `bun run ${scriptName}`;
      case 'npm':
      default:
        return scriptName === 'test' ? 'npm test' : `npm run ${scriptName}`;
    }
  }
}
