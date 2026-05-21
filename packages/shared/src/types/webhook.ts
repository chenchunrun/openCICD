export interface GitHubIssuePayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    labels: Array<{ name: string }>;
    user: { login: string };
  };
  repository: {
    full_name: string;
    html_url: string;
    default_branch: string;
  };
}

export interface GitHubPullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    head: { ref: string; sha: string };
    base: { ref: string };
    user: { login: string };
  };
  repository: {
    full_name: string;
    html_url: string;
  };
}

export interface GitHubWorkflowRunPayload {
  action: string;
  workflow_run: {
    id: number;
    conclusion: string | null;
    head_branch: string;
    head_sha: string;
    event: string;
    name: string;
    html_url: string;
  };
  repository: {
    full_name: string;
    html_url: string;
  };
}

export interface GitHubIssueCommentPayload {
  action: string;
  comment: {
    body: string;
    html_url: string;
    user: { login: string };
  };
  issue: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    pull_request?: unknown;
    labels: Array<{ name: string }>;
  };
  repository: {
    full_name: string;
    html_url: string;
  };
}

export type WebhookEventType =
  | 'issues'
  | 'pull_request'
  | 'workflow_run'
  | 'issue_comment'
  | 'push';

export interface ParsedWebhookEvent {
  eventType: WebhookEventType;
  action: string;
  repoFullName: string;
  payload: Record<string, unknown>;
}
