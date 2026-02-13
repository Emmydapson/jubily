/* eslint-disable prettier/prettier */
import { IsString, MinLength } from 'class-validator';

export class UpsertKeyDto {
  @IsString()
  @MinLength(6)
  key!: string;
}
