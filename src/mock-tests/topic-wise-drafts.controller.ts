import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { TopicWiseDraftsService } from './topic-wise-drafts.service';
import { CreateTopicWiseDraftDto } from './dto/create-topic-wise-draft.dto';
import { PublishTopicWiseDraftDto } from './dto/publish-topic-wise-draft.dto';
import { ReplaceTopicWiseQuestionDto } from './dto/replace-topic-wise-question.dto';
import {
  PublishTopicWiseDraftResultDto,
  TopicWiseDraftListItemDto,
  TopicWiseDraftResponseDto,
  TopicWiseSearchQuestionItemDto,
} from './dto/topic-wise-draft-response.dto';

@ApiTags('mock-tests')
@Controller('mock-tests/drafts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'JWT required' })
@ApiForbiddenResponse({ description: 'Admin role required' })
export class TopicWiseDraftsController {
  constructor(private readonly draftsService: TopicWiseDraftsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a topic-wise mock draft (Admin)',
    description: `
When \`questionIds\` is omitted, samples questions with the same rules as instant topic-wise create: exam tag, subject, required topic, and the easy/medium/hard mix.
When \`questionIds\` is set, those questions are frozen in that order. They must share one subject and one topic.
The result is a draft in \`topicwisetestdrafts\` with status \`REVIEW\`. Nothing is written to \`mocktests\` until publish.
    `,
  })
  @ApiCreatedResponse({ type: TopicWiseDraftResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid mix, short bank, or hand-picked questions that do not share a topic',
  })
  @ApiNotFoundResponse({ description: 'Exam or subject not found' })
  async createDraft(
    @Body() dto: CreateTopicWiseDraftDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string; data: TopicWiseDraftResponseDto }> {
    const draft = await this.draftsService.createDraft(dto, user.id);
    return {
      message: 'Topic-wise draft generated successfully',
      data: draft,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List open topic-wise drafts (Admin)',
    description:
      'Drafts still in REVIEW, GENERATING, or PUBLISHING. Discarded and published drafts are excluded.',
  })
  @ApiQuery({ name: 'examId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiOkResponse({ type: TopicWiseDraftListItemDto, isArray: true })
  async listDrafts(
    @Query('examId') examId: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<{
    message: string;
    data: TopicWiseDraftListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.draftsService.listDrafts(examId, page, limit);
    return {
      message: 'Drafts retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('questions')
  @ApiOperation({
    summary: 'Search questions for a topic-wise draft replacement (Admin)',
    description:
      'Scoped to the draft exam and subject. When the draft has a topic, results stay on that topic. Any eligible difficulty may be returned. Questions already on the paper are excluded.',
  })
  @ApiQuery({ name: 'draftId', required: true })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'topicId', required: false })
  @ApiQuery({
    name: 'difficultyLevel',
    required: false,
    enum: ['easy', 'medium', 'hard'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: TopicWiseSearchQuestionItemDto, isArray: true })
  async searchQuestions(
    @Query('draftId') draftId?: string,
    @Query('search') search?: string,
    @Query('topicId') topicId?: string,
    @Query('difficultyLevel') difficultyLevel?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ): Promise<{
    message: string;
    data: TopicWiseSearchQuestionItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.draftsService.searchQuestions({
      draftId,
      search,
      topicId,
      difficultyLevel,
      page,
      limit,
    });
    return {
      message: 'Questions retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a topic-wise draft for review (Admin)' })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  @ApiOkResponse({ type: TopicWiseDraftResponseDto })
  @ApiNotFoundResponse({ description: 'Draft not found or discarded' })
  async getDraft(
    @Param('id') id: string,
  ): Promise<{ message: string; data: TopicWiseDraftResponseDto }> {
    const draft = await this.draftsService.getDraft(id);
    return { message: 'Draft retrieved successfully', data: draft };
  }

  @Patch(':id/questions/:position')
  @ApiOperation({
    summary: 'Replace one question in a topic-wise draft (Admin)',
    description:
      'The replacement must match the slot subject, be tagged to the draft exam, and not already be on the paper. When the draft has a topic, the replacement must be that topic. Difficulty may change.',
  })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  @ApiParam({ name: 'position', description: '0-based index across the paper' })
  @ApiOkResponse({ type: TopicWiseDraftResponseDto })
  @ApiBadRequestResponse({
    description:
      'Draft not editable, subject or topic mismatch, duplicate, or ineligible question',
  })
  async replaceQuestion(
    @Param('id') id: string,
    @Param('position', ParseIntPipe) position: number,
    @Body() dto: ReplaceTopicWiseQuestionDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string; data: TopicWiseDraftResponseDto }> {
    const draft = await this.draftsService.replaceQuestion(
      id,
      position,
      dto.questionId,
      user.id,
    );
    return { message: 'Question replaced successfully', data: draft };
  }

  @Post(':id/publish')
  @ApiOperation({
    summary: 'Publish a topic-wise draft (Admin)',
    description:
      'Writes paperType TOPIC_WISE into mocktests with the same fields as instant create. The draft must be REVIEW. On failure the draft returns to REVIEW.',
  })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  @ApiOkResponse({ type: PublishTopicWiseDraftResultDto })
  async publishDraft(
    @Param('id') id: string,
    @Body() dto: PublishTopicWiseDraftDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string; data: PublishTopicWiseDraftResultDto }> {
    const result = await this.draftsService.publishDraft(id, dto, user.id);
    return {
      message: 'Mock test published successfully',
      data: result,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Discard a topic-wise draft (Admin)',
    description:
      'Sets status to DISCARDED. Does not write a mock test. Published drafts cannot be discarded.',
  })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  async discardDraft(
    @Param('id') id: string,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string }> {
    await this.draftsService.discardDraft(id, user.id);
    return { message: 'Draft discarded successfully' };
  }
}
