import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Opaque refresh token (mobile). Web browsers send the HttpOnly examflex_rt cookie instead.',
  })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  refreshToken?: string;
}
