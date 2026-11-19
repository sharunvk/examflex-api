import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MistakeBookStartWithDto } from './mistake-book-response.dto';

/** Lightweight Mistake Book summary for the Today BFF — no session list. */
export class MistakeBookTeaserDto {
  @ApiProperty({ example: 19 })
  totalMistakes: number;

  @ApiPropertyOptional({
    type: MistakeBookStartWithDto,
    nullable: true,
    description: 'Newest session with remaining mistakes',
  })
  startWith: MistakeBookStartWithDto | null;

  constructor(partial: Partial<MistakeBookTeaserDto>) {
    Object.assign(this, partial);
  }
}
