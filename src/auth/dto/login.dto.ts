import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'admin@joinjubily.com',
    description: 'Admin email address.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery-staple',
    minLength: 6,
    description: 'Admin password.',
  })
  @IsString()
  @MinLength(6)
  password!: string;
}
