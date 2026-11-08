import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class SignedUrlDto {
  @ApiProperty({ example: 'admin-images/1710000000-abcd.png' })
  @IsString()
  @MaxLength(1024)
  @Matches(/^(?!.*\.\.)(?!\/)[^\\\0]+$/, {
    message: 'Invalid object key',
  })
  key: string;

  @ApiProperty({ example: 'examflex-image-bucket' })
  @IsString()
  @MaxLength(255)
  bucket: string;
}
