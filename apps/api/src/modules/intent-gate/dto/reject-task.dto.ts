import { IsString, MinLength } from 'class-validator';

export class RejectTaskDto {
  @IsString()
  @MinLength(1)
  approver!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}
