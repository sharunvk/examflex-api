import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import {
  TodayApiResponseDto,
  TodayPageResponseDto,
} from './dto/today-response.dto';
import { TodayService } from './today.service';

@ApiTags('today')
@Controller('today')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class TodayController {
  constructor(private readonly todayService: TodayService) {}

  @Get()
  @ApiOperation({
    summary: 'Student Today dashboard payload',
    description: `
Single BFF payload for the /today screen:

- Empty vs active mode (based on completed full mocks)
- Next-step CTA, derived session checklist, latest mock + last 3 bars
- Subject insights from Analysis (topic-wise %), Equation Book promo, next mock teaser, Perspective lock

Cache TTL is 5 minutes; invalidated when an attempt is submitted or expires.
    `,
  })
  @ApiQuery({
    name: 'examId',
    required: true,
    description: 'Target exam ObjectId',
  })
  @ApiOkResponse({ type: TodayApiResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async getToday(
    @GetUser() user: UserResponseDto,
    @Query('examId') examId: string,
  ): Promise<{ message: string; data: TodayPageResponseDto }> {
    const data = await this.todayService.getToday(user.id, examId);
    return {
      message: 'Today dashboard retrieved successfully',
      data,
    };
  }
}
