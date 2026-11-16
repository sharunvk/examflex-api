import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { MockTestsService } from './mock-tests.service';
import { MockTestResponseDto } from './dto/mock-test-response.dto';
import { MockTestListItemDto } from './dto/mock-test-list-item.dto';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CreateTopicWiseMockTestDto } from './dto/create-topic-wise-mock-test.dto';

@ApiTags('mock-tests')
@Controller('mock-tests')
@UseGuards(JwtAuthGuard) // All routes require authentication
@ApiBearerAuth('JWT-auth')
export class MockTestsController {
  constructor(private readonly mockTestsService: MockTestsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all mock tests with pagination and search',
    description: `
    Retrieves a paginated list of **topic-wise** mock tests (\`paperType: TOPIC_WISE\`).
    Sprint papers and full-exam papers are excluded — use \`GET /sprint-tests\` and \`GET /full-mock-tests\`.

    Each row includes \`userAttemptAction\` (\`START\` | \`RESUME\` | \`RETAKE\`).
    Take the test with \`POST /mock-test-attempts/start\` (or resume if RESUME).
    Topic-wise papers always use a single timer and \`POST .../submit\` (no sessions/complete).
    `,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (minimum: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (minimum: 1, maximum: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term to filter by title or description',
    example: 'NEET',
  })
  @ApiQuery({
    name: 'examId',
    required: false,
    description: 'Only topic-wise papers for this exam',
  })
  @ApiQuery({
    name: 'subjectId',
    required: false,
    description: 'Only topic-wise papers for this subject',
  })
  @ApiQuery({
    name: 'topicId',
    required: false,
    description: 'Only topic-wise papers for this topic',
  })
  @ApiResponse({
    status: 200,
    description: 'Mock tests retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Mock tests retrieved successfully',
        },
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/MockTestResponseDto' },
        },
        pagination: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 45 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            totalPages: { type: 'number', example: 5 },
            hasNextPage: { type: 'boolean', example: true },
            hasPrevPage: { type: 'boolean', example: false },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('examId') examId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('topicId') topicId?: string,
    @GetUser() user?: UserResponseDto,
  ): Promise<{
    message: string;
    data: MockTestResponseDto[];
    pagination: any;
  }> {
    const result = await this.mockTestsService.findAll(
      page,
      limit,
      search,
      user?.id,
      user?.role === UserRole.ADMIN,
      { examId, subjectId, topicId },
    );
    return {
      message: search
        ? `Mock tests matching "${search}" retrieved successfully`
        : 'Mock tests retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get mock test statistics (Admin only)',
    description: `
    Retrieves comprehensive statistics about **topic-wise** mock tests including:
    - Total and active tests
    - Distribution by generation mode (STATIC/DYNAMIC)
    - Total questions by difficulty level across all tests
    
    Full-exam and sprint papers are excluded. Requires admin privileges.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Mock test statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            totalTests: { type: 'number', example: 45 },
            activeTests: { type: 'number', example: 40 },
            inactiveTests: { type: 'number', example: 5 },
            byGenerationMode: {
              type: 'object',
              properties: {
                static: { type: 'number', example: 35 },
                dynamic: { type: 'number', example: 10 },
              },
            },
            totalQuestionsByDifficulty: {
              type: 'object',
              properties: {
                easy: { type: 'number', example: 150 },
                medium: { type: 'number', example: 300 },
                hard: { type: 'number', example: 100 },
              },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required or insufficient privileges',
  })
  async getStats(): Promise<{
    message: string;
    data: any;
  }> {
    const stats = await this.mockTestsService.getStats();
    return {
      message: 'Mock test statistics retrieved successfully',
      data: stats,
    };
  }

  @Get('active')
  @ApiOperation({
    summary: 'Get active mock tests only',
    description: `
    Retrieves only active **topic-wise** mock tests with pagination.
    Full-exam and sprint papers are excluded. Sorted by newest first.
    `,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (minimum: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (minimum: 1, maximum: 100)',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Active mock tests retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async findActive(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @GetUser() user?: UserResponseDto,
  ): Promise<{
    message: string;
    data: MockTestResponseDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.mockTestsService.findActive(
      page,
      limit,
      user?.id,
    );
    return {
      message: 'Active mock tests retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('exam/:examId')
  @ApiOperation({
    summary: 'Get mock tests by exam',
    description: `
    Retrieves **topic-wise** mock tests filtered by exam ID with pagination.
    Full-exam and sprint papers for this exam are **not** included
    (see \`GET /full-mock-tests?examId=\` and \`GET /sprint-tests?examId=\`).
    
    Returns populated exam, subject, and topic details (excludes questionIds and difficultyDistribution).
    
    Supports optional topic name search and subject filter, which can be used independently or together.

    Ordered by free papers first (\`accessMode: FREE\` before \`ENTITLED\`), then earliest \`createdAt\`.
    `,
  })
  @ApiParam({
    name: 'examId',
    description: 'Exam ID',
    example: '64f123456789abcdef123456',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (minimum: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (minimum: 1, maximum: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term to filter by topic name (case-insensitive)',
    example: 'antonym',
  })
  @ApiQuery({
    name: 'subjectId',
    required: false,
    type: String,
    description: 'Subject ID to filter mock tests by subject',
    example: '64f123456789abcdef123456',
  })
  @ApiQuery({
    name: 'topicId',
    required: false,
    type: String,
    description: 'Topic (chapter) ID to filter mock tests',
    example: '64f123456789abcdef123456',
  })
  @ApiResponse({
    status: 200,
    description: 'Mock tests retrieved successfully',
    type: MockTestListItemDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async findByExam(
    @Param('examId') examId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('subjectId') subjectId?: string,
    @Query('topicId') topicId?: string,
    @GetUser() user?: UserResponseDto,
  ): Promise<{
    message: string;
    data: MockTestListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.mockTestsService.findByExam(
      examId,
      page,
      limit,
      user?.id,
      search,
      subjectId,
      topicId,
    );
    return {
      message: 'Mock tests for exam retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('subject/:subjectId')
  @ApiOperation({
    summary: 'Get mock tests by subject',
    description: `
    Retrieves **topic-wise** mock tests filtered by subject ID with pagination.
    Full-exam and sprint papers are excluded.
    `,
  })
  @ApiParam({
    name: 'subjectId',
    description: 'Subject ID',
    example: '64f123456789abcdef123456',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (minimum: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (minimum: 1, maximum: 100)',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Mock tests retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async findBySubject(
    @Param('subjectId') subjectId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @GetUser() user?: UserResponseDto,
  ): Promise<{
    message: string;
    data: MockTestResponseDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.mockTestsService.findBySubject(
      subjectId,
      page,
      limit,
      user?.id,
    );
    return {
      message: 'Mock tests for subject retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('exam/:examId/subject/:subjectId')
  @ApiOperation({
    summary: 'Get mock tests by exam and subject',
    description: `
    Retrieves **topic-wise** mock tests filtered by both exam and subject ID with pagination.
    Useful for showing subject-specific topic papers within an exam. Full-exam and sprint papers are excluded.
    `,
  })
  @ApiParam({
    name: 'examId',
    description: 'Exam ID',
    example: '64f123456789abcdef123456',
  })
  @ApiParam({
    name: 'subjectId',
    description: 'Subject ID',
    example: '64f123456789abcdef123456',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (minimum: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (minimum: 1, maximum: 100)',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Mock tests retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async findByExamAndSubject(
    @Param('examId') examId: string,
    @Param('subjectId') subjectId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @GetUser() user?: UserResponseDto,
  ): Promise<{
    message: string;
    data: MockTestResponseDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.mockTestsService.findByExamAndSubject(
      examId,
      subjectId,
      page,
      limit,
      user?.id,
    );
    return {
      message: 'Mock tests for exam and subject retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single mock test by ID',
    description: `
    Retrieves detailed information about a specific **topic-wise** mock test.
    Returns 404 if the mock test doesn't exist, was soft-deleted, is a \`SPRINT\` paper
    (use \`GET /sprint-tests/:id\`), or is a \`FULL_EXAM\` paper
    (use \`GET /full-mock-tests/:id\`).
    `,
  })
  @ApiParam({
    name: 'id',
    description: 'Mock test ID',
    example: '64f123456789abcdef123456',
  })
  @ApiResponse({
    status: 200,
    description: 'Mock test retrieved successfully',
    type: MockTestResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Mock test not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async findOne(
    @Param('id') id: string,
    @GetUser() user?: UserResponseDto,
  ): Promise<{
    message: string;
    data: MockTestResponseDto;
  }> {
    const mockTest = await this.mockTestsService.findOne(id, user);
    return {
      message: 'Mock test retrieved successfully',
      data: mockTest,
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a topic-wise mock test (Admin only)' })
  async create(
    @Body() dto: CreateTopicWiseMockTestDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string; data: MockTestResponseDto }> {
    const mockTest = await this.mockTestsService.createTopicWise(dto, user.id);
    return {
      message: 'Mock test created successfully',
      data: mockTest,
    };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Update a topic-wise mock test and re-sample questions (Admin only)',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: CreateTopicWiseMockTestDto,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string; data: MockTestResponseDto }> {
    const mockTest = await this.mockTestsService.updateTopicWise(
      id,
      dto,
      user.id,
    );
    return {
      message: 'Mock test updated successfully',
      data: mockTest,
    };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Soft delete a topic-wise mock test (Admin only)' })
  async remove(
    @Param('id') id: string,
    @GetUser() user: UserResponseDto,
  ): Promise<{ message: string }> {
    return this.mockTestsService.removeTopicWise(id, user.id);
  }
}
