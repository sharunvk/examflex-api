import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  ParseBoolPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { ExamsService } from './exams.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { ExamResponseDto } from './dto/exam-response.dto';
import { ExamsByCategoryPageDto } from './dto/exams-by-category-response.dto';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';

@ApiTags('exams')
@Controller('exams')
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @Get('by-category')
  @ApiOperation({
    summary: 'Get exams grouped by category (Public API)',
    description: `
    Student mocks hub: active categories with showInApp exams.
    Paginated — default one category per page. Empty categories are omitted.
    Each exam includes description, statsLabel, and paperCounts by type.
    Ordered by category priority (highest first), then name.
    `,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Category page (minimum 1). Default 1.',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Categories per page (minimum 1, maximum 50). Default 1.',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Exams grouped by category with pagination',
    type: ExamsByCategoryPageDto,
  })
  async getExamsByCategory(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(1), ParseIntPipe) limit: number,
  ): Promise<{
    message: string;
    data: ExamsByCategoryPageDto['data'];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.examsService.getExamsByCategory(page, limit);
    return {
      message: 'Exams by category retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new exam (Admin only)',
    description: 'Creates a new exam under a specific category',
  })
  @ApiResponse({
    status: 201,
    description: 'Exam created successfully',
    type: ExamResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or invalid category',
  })
  @ApiConflictResponse({ description: 'Exam already exists' })
  @ApiUnauthorizedResponse({ description: 'Admin privileges required' })
  async create(
    @Body() createExamDto: CreateExamDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{
    message: string;
    data: ExamResponseDto;
  }> {
    const exam = await this.examsService.create(createExamDto, admin.id);
    return {
      message: 'Exam created successfully',
      data: exam,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Get all exams with pagination',
    description:
      'Retrieves all exams with optional filtering and search. Public endpoint.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
    example: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name or description',
    example: 'SBI',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    type: String,
    description: 'Filter by category ID',
    example: '64f123456789abcdef123456',
  })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    type: Boolean,
    description: 'Show only active exams',
    example: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Exams retrieved successfully',
    type: [ExamResponseDto],
  })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('activeOnly', new DefaultValuePipe(false), ParseBoolPipe)
    activeOnly?: boolean,
  ): Promise<{
    message: string;
    data: ExamResponseDto[];
    pagination: any;
  }> {
    const result = await this.examsService.findAll(
      page,
      limit,
      search,
      categoryId,
      activeOnly,
    );
    return {
      message: search
        ? `Exams matching "${search}" retrieved successfully`
        : 'Exams retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get('category/:categoryId')
  @ApiOperation({
    summary: 'Get exams by category with pagination',
    description:
      'Retrieves all exams for a specific category. Public endpoint.',
  })
  @ApiParam({
    name: 'categoryId',
    description: 'Category ID',
    example: '64f123456789abcdef123456',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Exams for category retrieved successfully',
    type: [ExamResponseDto],
  })
  async findByCategory(
    @Param('categoryId') categoryId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<{
    message: string;
    data: ExamResponseDto[];
    pagination: PaginationMetaDto;
  }> {
    const result = await this.examsService.findByCategory(
      categoryId,
      page,
      limit,
    );
    return {
      message: 'Exams for category retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get exam by ID',
    description: 'Retrieves a single exam by its ID. Public endpoint.',
  })
  @ApiParam({ name: 'id', description: 'Exam ID' })
  @ApiResponse({
    status: 200,
    description: 'Exam retrieved successfully',
    type: ExamResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  async findOne(@Param('id') id: string): Promise<{
    message: string;
    data: ExamResponseDto;
  }> {
    const exam = await this.examsService.findOne(id);
    return {
      message: 'Exam retrieved successfully',
      data: exam,
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update exam (Admin only)',
    description: 'Updates an existing exam',
  })
  @ApiParam({ name: 'id', description: 'Exam ID' })
  @ApiResponse({
    status: 200,
    description: 'Exam updated successfully',
    type: ExamResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Exam name already exists' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiUnauthorizedResponse({ description: 'Admin privileges required' })
  async update(
    @Param('id') id: string,
    @Body() updateExamDto: UpdateExamDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{
    message: string;
    data: ExamResponseDto;
  }> {
    const exam = await this.examsService.update(id, updateExamDto, admin.id);
    return {
      message: 'Exam updated successfully',
      data: exam,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete exam (Admin only)',
    description: 'Soft deletes an exam',
  })
  @ApiParam({ name: 'id', description: 'Exam ID' })
  @ApiResponse({
    status: 200,
    description: 'Exam deleted successfully',
    type: ExamResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiUnauthorizedResponse({ description: 'Admin privileges required' })
  async remove(
    @Param('id') id: string,
    @GetUser() admin: UserResponseDto,
  ): Promise<{
    message: string;
    data: ExamResponseDto;
  }> {
    const exam = await this.examsService.remove(id, admin.id);
    return {
      message: 'Exam deleted successfully',
      data: exam,
    };
  }
}
