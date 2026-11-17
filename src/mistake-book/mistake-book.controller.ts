import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { ListMistakeBookSessionsQueryDto } from './dto/list-sessions-query.dto';
import {
  MistakeBookSessionDetailDto,
  MistakeBookSessionsResponseDto,
} from './dto/mistake-book-response.dto';
import { MistakeBookSessionItemsQueryDto } from './dto/session-items-query.dto';
import { UpdateTripReasonDto } from './dto/update-trip-reason.dto';
import { MistakeBookService } from './mistake-book.service';

@ApiTags('mistake-book')
@Controller('mistake-book')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
export class MistakeBookController {
  constructor(private readonly mistakeBookService: MistakeBookService) {}

  @Get('sessions')
  @ApiOperation({
    summary: 'List Mistake Book sessions',
    description:
      'Returns mock papers with remaining wrong/unattended cards, newest attempt first. Empty sessions are omitted.',
  })
  @ApiOkResponse({ type: MistakeBookSessionsResponseDto })
  async listSessions(
    @GetUser() currentUser: UserResponseDto,
    @Query() query: ListMistakeBookSessionsQueryDto,
  ): Promise<{
    message: string;
    data: MistakeBookSessionsResponseDto['data'];
    pagination: MistakeBookSessionsResponseDto['pagination'];
    summary: MistakeBookSessionsResponseDto['summary'];
  }> {
    const result = await this.mistakeBookService.listSessions(
      currentUser.id,
      query.page,
      query.limit,
      query.subjectId,
      query.topicId,
    );
    return {
      message: 'Mistake Book sessions retrieved successfully',
      data: result.data,
      pagination: result.pagination,
      summary: result.summary,
    };
  }

  @Get('sessions/:mockTestId')
  @ApiOperation({
    summary: 'Get Mistake Book cards for a mock paper',
    description:
      'Remaining wrong and unattended questions for the latest attempt stored in the book. Supports subject/topic filters.',
  })
  @ApiOkResponse({ type: MistakeBookSessionDetailDto })
  @ApiNotFoundResponse({ description: 'No remaining Mistake Book session' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  async getSession(
    @GetUser() currentUser: UserResponseDto,
    @Param('mockTestId') mockTestId: string,
    @Query() query: MistakeBookSessionItemsQueryDto,
  ): Promise<{ message: string; data: MistakeBookSessionDetailDto }> {
    const data = await this.mistakeBookService.getSession(
      currentUser.id,
      mockTestId,
      query.subjectId,
      query.topicId,
    );
    return { message: 'Mistake Book session retrieved successfully', data };
  }

  @Patch('entries/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Update trip reason for a Mistake Book entry',
  })
  @ApiNoContentResponse({ description: 'Trip reason updated' })
  @ApiNotFoundResponse({ description: 'Entry not found' })
  async updateTripReason(
    @GetUser() currentUser: UserResponseDto,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateTripReasonDto,
  ): Promise<void> {
    await this.mistakeBookService.updateTripReason(
      currentUser.id,
      entryId,
      dto.tripReason,
    );
  }

  @Delete('entries/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a Mistake Book entry (Understood)',
  })
  @ApiNoContentResponse({ description: 'Entry removed' })
  @ApiNotFoundResponse({ description: 'Entry not found' })
  async deleteEntry(
    @GetUser() currentUser: UserResponseDto,
    @Param('entryId') entryId: string,
  ): Promise<void> {
    await this.mistakeBookService.deleteEntry(currentUser.id, entryId);
  }
}
