/* eslint-disable prettier/prettier */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT access token for authenticated requests',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiPropertyOptional({
    description:
      'Opaque refresh token for mobile. Omitted for web (HttpOnly examflex_rt cookie). Rotate via POST /auth/refresh.',
  })
  refreshToken?: string;

  @ApiPropertyOptional({
    description:
      'Access token lifetime in seconds from issue time (web ~900 / mobile longer)',
    example: 900,
  })
  expiresIn?: number;

  @ApiProperty({
    description: 'User information',
    type: UserResponseDto,
  })
  user: UserResponseDto;

  @ApiProperty({
    description: 'Indicates if this is a new user (first-time login)',
    example: false,
  })
  isNewUser: boolean;

  constructor(
    accessToken: string,
    user: UserResponseDto,
    isNewUser: boolean = false,
    extras?: { refreshToken?: string; expiresIn?: number },
  ) {
    this.accessToken = accessToken;
    this.user = user;
    this.isNewUser = isNewUser;
    if (extras?.refreshToken) {
      this.refreshToken = extras.refreshToken;
    }
    if (typeof extras?.expiresIn === 'number') {
      this.expiresIn = extras.expiresIn;
    }
  }
}
