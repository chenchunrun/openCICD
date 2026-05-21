import { IsIn, IsObject, IsOptional, IsString, IsUrl } from 'class-validator';

export class TaskSourceDto {
  @IsString()
  @IsIn(['github_issue', 'github_pr_comment', 'ci_failure', 'manual', 'incident'])
  type!: string;

  @IsOptional()
  @IsString()
  @IsUrl({
    require_protocol: true,
  })
  url?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
