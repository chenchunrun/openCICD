import { IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class OnboardRepoDto {
  @IsString()
  @IsIn(['github', 'gitlab', 'bitbucket'])
  platform!: string;

  @IsString()
  @MinLength(1)
  owner!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsUrl({
    require_protocol: true,
  })
  url!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  defaultBranch?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  localPath?: string;
}
