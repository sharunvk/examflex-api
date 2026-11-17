import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  MISTAKE_BOOK_SESSION_PAGE_LIMIT_DEFAULT,
  MISTAKE_BOOK_SESSION_PAGE_LIMIT_MAX,
} from '../mistake-book.constants';

export class ListMistakeBookSessionsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: MISTAKE_BOOK_SESSION_PAGE_LIMIT_DEFAULT,
    minimum: 1,
    maximum: MISTAKE_BOOK_SESSION_PAGE_LIMIT_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MISTAKE_BOOK_SESSION_PAGE_LIMIT_MAX)
  limit?: number = MISTAKE_BOOK_SESSION_PAGE_LIMIT_DEFAULT;
}
