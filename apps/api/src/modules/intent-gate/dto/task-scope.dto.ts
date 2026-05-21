import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class TaskScopeDto {
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  allowedPaths!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  forbiddenPaths?: string[];
}
