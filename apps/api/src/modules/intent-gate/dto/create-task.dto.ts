import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { TaskScopeDto } from './task-scope.dto.js';
import { TaskSourceDto } from './task-source.dto.js';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  repoId!: string;

  @ValidateNested()
  @Type(() => TaskSourceDto)
  source!: TaskSourceDto;

  @IsString()
  @MinLength(1)
  goal!: string;

  @ValidateNested()
  @Type(() => TaskScopeDto)
  scope!: TaskScopeDto;

  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  doneWhen!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  constraints?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  preferredAgent?: string;
}
