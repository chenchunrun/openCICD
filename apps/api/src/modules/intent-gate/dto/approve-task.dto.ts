import { IsOptional, IsString, MinLength } from 'class-validator';

export class ApproveTaskDto {
  @IsString()
  @MinLength(1)
  approver!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}
