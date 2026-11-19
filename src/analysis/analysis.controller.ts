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
import { AnalysisService } from './analysis.service';
import {
  AnalysisOverviewApiResponseDto,
  AnalysisOverviewResponseDto,
} from './dto/analysis-overview-response.dto';

@ApiTags('analysis')
@Controller('analysis')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Student analysis overview for a target exam',
    description: `
Returns a single payload for the Analysis page:

- Latest + last 5 completed **full mocks** (score bars)
- Pathway course offerings compared to the average of those attempts
- Chapter-wise (TOPIC_WISE) subject/topic strength insights

Requires \`examId\` (the student's target exam). Cache TTL is 5 minutes; invalidated when an attempt is submitted or expires.
    `,
  })
  @ApiQuery({
    name: 'examId',
    required: true,
    description: 'Target exam ObjectId',
  })
  @ApiOkResponse({ type: AnalysisOverviewApiResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async getOverview(
    @GetUser() user: UserResponseDto,
    @Query('examId') examId: string,
  ): Promise<{ message: string; data: AnalysisOverviewResponseDto }> {
    const data = await this.analysisService.getOverview(user.id, examId);
    return {
      message: 'Analysis overview retrieved successfully',
      data,
    };
  }
}
