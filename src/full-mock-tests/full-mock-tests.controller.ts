import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
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
import { FullMockTestsService } from './full-mock-tests.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { PublishDraftDto } from './dto/publish-draft.dto';
import { UpdateCourseCutoffsDto } from './dto/course-cutoff.dto';
import { ReplaceQuestionDto } from './dto/replace-question.dto';
import { FullMockExamListItemDto } from './dto/exam-list-item.dto';
import { DraftResponseDto } from './dto/draft-response.dto';
import { FullMockTestListItemDto } from './dto/full-mock-test-list-item.dto';
import { SearchQuestionItemDto } from './dto/search-question-item.dto';
import { PublishDraftResultDto } from './dto/publish-draft-result.dto';
import { DraftListItemDto } from './dto/draft-list-item.dto';

@ApiTags('full-mock-tests')
@Controller('full-mock-tests')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'JWT required' })
export class FullMockTestsController {
  constructor(private readonly fullMockTestsService: FullMockTestsService) {}

  @Get('exams')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List exams for full-mock generation (Admin)',
    description: `
Admin picker for creating a full mock. Returns **active, non-deleted** exams with
the columns needed for the exams table: name, duration (\`N mins\`), question count,
total marks, category name, exam-group name, subject names, and mode
(\`Mixed\` | \`Session-wise\`).

Pick an \`id\` and send it to \`POST /full-mock-tests/drafts\`.

Does **not** create a paper. Does **not** list mock tests.
    `,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (minimum 1). Default 1.',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size (1–100). Default 10.',
    example: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Case-insensitive match on exam name or description',
    example: 'CGL',
  })
  @ApiOkResponse({
    description: 'Paginated exam list',
    type: FullMockExamListItemDto,
    isArray: true,
  })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async listExams(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ): Promise<{
    message: string;
    data: FullMockExamListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.fullMockTestsService.listExamsForAdmin(
      page,
      limit,
      search,
    );
    return {
      message: 'Exams retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Post('drafts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate a full-mock draft from an exam (Admin)',
    description: `
Samples a complete paper from the question bank to match the exam blueprint:

- Subject order and quotas from \`exam.subjects[]\`
- Marks / negative marking from each subject row
- Mixed: one timer = \`exam.duration\`; questions are shuffled across the whole pack
- Session-wise: every subject must have \`sessionTime > 0\`; subject/session order is preserved; each session is shuffled internally
- Within a shuffle, same-topic questions are separated when possible
- Topic split inside a subject uses inventory + usage-weighted sampling

The result is a **draft** in \`fullmocktestdrafts\` (status \`REVIEW\`).
Session-wise papers keep contiguous subject blocks in exam order; mixed papers may interleave subjects.
Nothing is written to \`mocktests\` until publish.

Correct answers and explanations are **not** returned.

Error codes (400): \`BLUEPRINT_INVALID\`, \`BANK_SHORTAGE\`. 404: \`EXAM_NOT_FOUND\`.
    `,
  })
  @ApiCreatedResponse({
    description: 'Draft generated and ready for review',
    type: DraftResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Blueprint inconsistent (totals/duration/session times) or not enough eligible questions for a subject',
  })
  @ApiNotFoundResponse({ description: 'Exam not found or inactive' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async createDraft(
    @Body() dto: CreateDraftDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string; data: DraftResponseDto }> {
    const draft = await this.fullMockTestsService.createDraft(dto, user.id);
    return {
      message: 'Full mock draft generated successfully',
      data: draft,
    };
  }

  @Get('drafts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List open full-mock drafts (Admin)',
    description: `
Paginated list of drafts that are still in progress (\`REVIEW\`, \`GENERATING\`,
\`PUBLISHING\`). Discarded and published drafts are excluded — published papers
appear on \`GET /full-mock-tests\`.

Use \`GET /full-mock-tests/drafts/:id\` to resume review / replace / publish.
    `,
  })
  @ApiQuery({
    name: 'examId',
    required: false,
    description: 'When set, only drafts for this exam',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '1–100, default 10',
    example: 10,
  })
  @ApiOkResponse({
    description: 'Paginated open drafts',
    type: DraftListItemDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'examId invalid' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async listDrafts(
    @Query('examId') examId: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<{
    message: string;
    data: DraftListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.fullMockTestsService.listDrafts(
      examId,
      page,
      limit,
    );
    return {
      message: 'Drafts retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('questions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Search questions for draft replacement (Admin)',
    description: `
Replace-picker search over the question bank.

- \`subjectId\` is required unless \`allowCrossSubject=true\` (must match the slot by default).
- Pass \`draftId\` to scope to questions tagged to that draft’s exam, and to exclude IDs already on the paper.
- \`allowCrossSubject=true\` (requires \`draftId\`) lists exam-tagged questions from any subject. \`subjectId\` is then optional.
- Optional filters: topic, difficulty, text search (EN/ML).
- Returns safe fields only (no correctAnswer / explanation).
    `,
  })
  @ApiQuery({
    name: 'subjectId',
    required: false,
    description:
      'Subject filter. Required unless allowCrossSubject=true. Defaults to the slot subject in the admin UI.',
  })
  @ApiQuery({
    name: 'draftId',
    required: false,
    description:
      'When set, only questions tagged to this draft’s exam are returned, and questions already on the paper are excluded. Required when allowCrossSubject=true.',
  })
  @ApiQuery({
    name: 'allowCrossSubject',
    required: false,
    type: Boolean,
    description:
      'When true (and draftId is set), subjectId may be omitted or differ from the slot. Exam tagging still applies.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Case-insensitive match on English or Malayalam question text',
  })
  @ApiQuery({
    name: 'topicId',
    required: false,
    description:
      'Optional topic filter (may differ from the original slot topic)',
  })
  @ApiQuery({
    name: 'difficultyLevel',
    required: false,
    enum: ['easy', 'medium', 'hard'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '1–50, default 20',
    example: 20,
  })
  @ApiOkResponse({
    description: 'Paginated eligible questions',
    type: SearchQuestionItemDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid subjectId, topicId, or allowCrossSubject without draftId',
  })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async searchQuestions(
    @Query('subjectId') subjectId?: string,
    @Query('draftId') draftId?: string,
    @Query('search') search?: string,
    @Query('topicId') topicId?: string,
    @Query('difficultyLevel') difficultyLevel?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('allowCrossSubject', new DefaultValuePipe(false), ParseBoolPipe)
    allowCrossSubject?: boolean,
  ): Promise<{
    message: string;
    data: SearchQuestionItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.fullMockTestsService.searchQuestions({
      subjectId,
      draftId,
      search,
      topicId,
      difficultyLevel,
      page,
      limit,
      allowCrossSubject,
    });
    return {
      message: 'Questions retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('drafts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get a full-mock draft for review (Admin)',
    description: `
Returns the draft grouped by subject, with safe question payloads (no keys).
Use this after generate and after each replace.

Discarded drafts return 404.
    `,
  })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  @ApiOkResponse({ description: 'Draft', type: DraftResponseDto })
  @ApiNotFoundResponse({ description: 'Draft not found or discarded' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async getDraft(@Param('id') id: string): Promise<{
    message: string;
    data: DraftResponseDto;
  }> {
    const draft = await this.fullMockTestsService.getDraft(id);
    return {
      message: 'Draft retrieved successfully',
      data: draft,
    };
  }

  @Patch('drafts/:id/questions/:position')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Replace one question in a draft (Admin)',
    description: `
Swaps the question at \`position\` (0-based across the whole paper).

Guards:
- Draft status must be \`REVIEW\`
- Incoming question subject **must** match the slot subject unless \`allowCrossSubject\` is true (keeps quota, marks, session)
- Incoming question **must** be tagged to this draft’s exam
- Incoming question must not already be on the paper
- Topic may change
- Slot subject / marks / negative marking / position are **not** changed
- Usage counts are **not** incremented (that happens on publish)

Error codes: \`DRAFT_NOT_EDITABLE\`, \`SUBJECT_MISMATCH\`, \`EXAM_MISMATCH\`, \`DUPLICATE_QUESTION\`, \`QUESTION_NOT_ELIGIBLE\`.
    `,
  })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  @ApiParam({
    name: 'position',
    description: '0-based index in the paper (see each question.position)',
    example: 12,
  })
  @ApiOkResponse({
    description: 'Updated draft',
    type: DraftResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Draft not editable, subject mismatch, exam mismatch, duplicate, or ineligible question',
  })
  @ApiNotFoundResponse({ description: 'Draft not found' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async replaceQuestion(
    @Param('id') id: string,
    @Param('position', ParseIntPipe) position: number,
    @Body() dto: ReplaceQuestionDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string; data: DraftResponseDto }> {
    const draft = await this.fullMockTestsService.replaceQuestion(
      id,
      position,
      dto.questionId,
      dto.allowCrossSubject,
      user.id,
    );
    return {
      message: 'Question replaced successfully',
      data: draft,
    };
  }

  @Post('drafts/:id/publish')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Publish a draft as a FULL_EXAM mock test (Admin)',
    description: `
Writes the paper into \`mocktests\` with \`paperType: FULL_EXAM\`, then increments
\`fullMockUsageCount\` / \`lastUsedInFullMockAt\` on every question.

Session-wise: questions are regrouped into contiguous subject blocks in exam
subject/session order. Mixed: draft order is kept (whole-pack shuffle) unless
\`keepSubjectOrder\` is true, which groups mixed papers the same way.
Each \`subjectConfig\` row stores \`questionIds\` plus start/end indexes.

Students then see it on \`GET /full-mock-tests\` and take it with \`POST /mock-test-attempts/start\`.
Session-wise papers use per-subject timers and \`POST /mock-test-attempts/{id}/sessions/complete\`.

Draft must be \`REVIEW\`. After success the draft becomes \`PUBLISHED\`.
Topic-wise \`/mock-tests\` lists never include this paper.
    `,
  })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  @ApiOkResponse({
    description: 'Published mock test ID and updated draft',
    type: PublishDraftResultDto,
  })
  @ApiBadRequestResponse({
    description:
      'Draft not editable, duplicate questions on the paper, or incomplete paper',
  })
  @ApiNotFoundResponse({ description: 'Draft not found' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async publishDraft(
    @Param('id') id: string,
    @Body() dto: PublishDraftDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{
    message: string;
    data: PublishDraftResultDto;
  }> {
    const result = await this.fullMockTestsService.publishDraft(
      id,
      dto,
      user.id,
    );
    return {
      message: 'Full mock test published successfully',
      data: result,
    };
  }

  @Delete('drafts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Discard a full-mock draft (Admin)',
    description: `
Sets status to \`DISCARDED\`. Does **not** increment question usage.
Published drafts cannot be discarded (delete the mock test instead if needed).
    `,
  })
  @ApiParam({ name: 'id', description: 'Draft ID' })
  @ApiOkResponse({ description: 'Draft discarded' })
  @ApiBadRequestResponse({
    description: 'Published drafts cannot be discarded',
  })
  @ApiNotFoundResponse({ description: 'Draft not found' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async discardDraft(
    @Param('id') id: string,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string }> {
    await this.fullMockTestsService.discardDraft(id, user.id);
    return { message: 'Draft discarded successfully' };
  }

  @Get()
  @ApiOperation({
    summary: 'List published full mock tests',
    description: `
Student (or any authenticated user) catalog of **published** \`paperType: FULL_EXAM\` papers.

How to take the test:
- \`userAttemptAction === START\` or \`RETAKE\` → \`POST /mock-test-attempts/start\` with this row's \`id\`
- \`userAttemptAction === RESUME\` → \`GET /mock-test-attempts/{resumeAttemptId}/resume\` (do not start again)
- Then follow mock-test-attempts: if \`isSessionWise\`, one subject at a time + \`POST .../sessions/complete\`

Also on each row: \`isSessionWise\`, \`subjectConfig\` (\`questionIds\`, \`numberOfQuestions\`). Topic-wise papers are not included (\`GET /mock-tests\`).

Students only see active papers. Admins also see inactive ones. \`examId\` is optional.

Ordered by free papers first (\`accessMode: FREE\` before \`ENTITLED\`), then earliest \`createdAt\`.
    `,
  })
  @ApiQuery({
    name: 'examId',
    required: false,
    description: 'When set, only full mocks for this exam',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '1–100, default 10',
    example: 10,
  })
  @ApiOkResponse({
    description: 'Paginated full mock tests',
    type: FullMockTestListItemDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'examId invalid' })
  async listPublished(
    @Query('examId') examId: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @GetUser() user: UserResponseDto,
  ): Promise<{
    message: string;
    data: FullMockTestListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.fullMockTestsService.listPublished(
      examId,
      page,
      limit,
      user?.id,
      user?.role === UserRole.ADMIN,
    );
    return {
      message: 'Full mock tests retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one published full mock test',
    description: `
Returns a single published \`FULL_EXAM\` paper (404 if the id is topic-wise or a sprint).

Includes \`userAttemptAction\` / \`resumeAttemptId\` and \`subjectConfig\` (question counts and \`questionIds\` per subject).

**Admins** also receive \`subjects\`: safe question payloads grouped by subject
(same shape as draft review — no correctAnswer / explanation), for the published
view screen.

Students do not receive stems here — start or resume an attempt to get the paper.

Take-test: \`POST /mock-test-attempts/start\` or \`GET /mock-test-attempts/{id}/resume\` as indicated by \`userAttemptAction\`.
    `,
  })
  @ApiParam({ name: 'id', description: 'Published full mock test ID' })
  @ApiOkResponse({
    description: 'Full mock test',
    type: FullMockTestListItemDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid ID' })
  @ApiNotFoundResponse({
    description: 'Not a published FULL_EXAM paper (or deleted)',
  })
  async findOne(
    @Param('id') id: string,
    @GetUser() user: UserResponseDto,
  ): Promise<{
    message: string;
    data: FullMockTestListItemDto;
  }> {
    const isAdmin = user?.role === UserRole.ADMIN;
    const test = await this.fullMockTestsService.findOnePublished(
      id,
      user.id,
      isAdmin,
    );
    return {
      message: 'Full mock test retrieved successfully',
      data: test,
    };
  }

  @Patch(':id/course-cutoffs')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Set or clear course cut-offs on a published full mock (Admin)',
    description: `
Upserts per-course cut-off marks (absolute marks on the paper's scale) on a
published \`FULL_EXAM\` paper. A number sets/replaces the cut-off for that course;
\`null\` removes it; courses not listed keep their stored value.

**Only \`courseCutoffs\` (and the audit actor) are written.** Questions, marks,
timers and every other field of the published paper are untouched.

Each course must be an active \`COURSE\` of the paper's exam, and the cut-off
must be > 0 and <= the paper's total marks. Student Analysis picks the change up
within the analysis cache TTL (5 minutes).
    `,
  })
  @ApiParam({ name: 'id', description: 'Published full mock test ID' })
  @ApiOkResponse({
    description: 'Updated full mock test (admin view, includes courseCutoffs)',
    type: FullMockTestListItemDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid id, duplicate course, unknown/inactive/other-exam course, or cut-off out of range',
  })
  @ApiNotFoundResponse({ description: 'Not a published FULL_EXAM paper' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async updateCourseCutoffs(
    @Param('id') id: string,
    @Body() dto: UpdateCourseCutoffsDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{
    message: string;
    data: FullMockTestListItemDto;
  }> {
    const data = await this.fullMockTestsService.updateCourseCutoffs(
      id,
      dto,
      user.id,
    );
    return {
      message: 'Course cut-offs updated successfully',
      data,
    };
  }
}
