export interface RepoConfig {
  id: string;
  platform: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  languages: string[];
  packageManager?: string;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  codeownersPath?: string;
  highRiskPaths: string[];
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LanguageStack {
  languages: string[];
  packageManager?: string;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
}

export interface ToolCommands {
  test?: string;
  lint?: string;
  typecheck?: string;
  build?: string;
}

export interface HighRiskPathResult {
  detectedPaths: string[];
  allPatterns: string[];
}

export interface OnboardRepoInput {
  platform: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch?: string;
}

export interface OnboardRepoResult {
  repo: RepoConfig;
  languageStack: LanguageStack;
  highRiskPaths: string[];
  generatedFiles: string[];
}
