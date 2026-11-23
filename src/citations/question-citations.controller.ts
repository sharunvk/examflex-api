import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { QuestionCitationsService } from './question-citations.service';
import {
  CitationSearchQueryDto,
  CitationSearchResponseDto,
  QuestionCitationsResponseDto,
  SaveCitationsDto,
} from './dto/citation.dto';

@ApiTags('questions')
@Controller('questions/:id/citations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Admin privileges required' })
export class QuestionCitationsController {
  constructor(private readonly citations: QuestionCitationsService) {}

  @Get()
  @ApiOperation({ summary: 'Saved NCERT citations of a question (Admin only)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: QuestionCitationsResponseDto })
  async get(
    @Param('id') id: string,
  ): Promise<{ message: string; data: QuestionCitationsResponseDto }> {
    return {
      message: 'Citations retrieved successfully',
      data: await this.citations.getCitations(id),
    };
  }

  @Get('search')
  @ApiOperation({
    summary:
      'Search NCERT chunks for a question to pick citations from (Admin only)',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CitationSearchResponseDto })
  async search(
    @Param('id') id: string,
    @Query() query: CitationSearchQueryDto,
  ): Promise<{ message: string; data: CitationSearchResponseDto }> {
    return {
      message: 'Citation search completed',
      data: await this.citations.searchForQuestion(id, query),
    };
  }

  @Put()
  @ApiOperation({
    summary: 'Save a ranked selection of NCERT citations (Admin only)',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: QuestionCitationsResponseDto })
  async save(
    @Param('id') id: string,
    @Body() dto: SaveCitationsDto,
  ): Promise<{ message: string; data: QuestionCitationsResponseDto }> {
    return {
      message: 'Citations saved successfully',
      data: await this.citations.saveSelection(id, dto.chunkIds),
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Re-run automatic citations, replacing any admin selection (Admin only)',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: QuestionCitationsResponseDto })
  async refresh(
    @Param('id') id: string,
  ): Promise<{ message: string; data: QuestionCitationsResponseDto }> {
    return {
      message: 'Citations refreshed',
      data: await this.citations.refresh(id),
    };
  }
}
