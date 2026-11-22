import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    description:
      'Access token returned by the MSG91 widget after the learner entered the emailed OTP. The email address is taken from MSG91, never from the client.',
  })
  @IsString({ message: 'Access token must be a valid string' })
  @IsNotEmpty({ message: 'Access token is required' })
  @MaxLength(4096)
  accessToken: string;
}
