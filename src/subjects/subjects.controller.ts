import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { SubjectResponseDto } from './dto/subject-response.dto';
import { SubjectForExamResponseDto } from './dto/subject-for-exam-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { InstanceVectorSubjectResponseDto } from '../instance-config/dto/instance-config-response.dto';

@ApiTags('subjects')
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new subject (Admin only)',
    description:
      'Creates a new subject like Quantitative Aptitude, General Knowledge, etc.',
  })
  @ApiResponse({
    status: 201,
    description: 'Subject created successfully',
    type: SubjectResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Subject already exists' })
  @ApiUnauthorizedResponse({ description: 'Admin privileges required' })
  async create(
    @Body() createSubjectDto: CreateSubjectDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{
    message: string;
    data: SubjectResponseDto;
  }> {
    const subject = await this.subjectsService.create(
      createSubjectDto,
      admin.id,
    );
    return {
      message: 'Subject created successfully',
      data: subject,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Get all subjects',
    description:
      'Retrieves all subjects with populated topics. Public endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'Subjects retrieved successfully',
    type: [SubjectResponseDto],
  })
  async findAll(): Promise<{
    message: string;
    data: SubjectResponseDto[];
    count: number;
  }> {
    const subjects = await this.subjectsService.findAll();
    return {
      message: 'Subjects retrieved successfully',
      data: subjects,
      count: subjects.length,
    };
  }

  @Get('exam/:examId')
  @ApiOperation({
    summary: 'Get subjects by exam',
    description:
      'Retrieves all subjects associated with a specific exam. Useful for populating subject filter dropdowns.',
  })
  @ApiParam({
    name: 'examId',
    description: 'Exam ID',
    example: '64f123456789abcdef123456',
  })
  @ApiResponse({
    status: 200,
    description: 'Subjects for exam retrieved successfully',
    type: [SubjectForExamResponseDto],
  })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  async findByExam(@Param('examId') examId: string): Promise<{
    message: string;
    data: SubjectForExamResponseDto[];
  }> {
    const subjects = await this.subjectsService.findByExam(examId);
    return {
      message: 'Subjects for exam retrieved successfully',
      data: subjects,
    };
  }

  @Get('vector-subjects')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'NCERT vector subjects a subject can map to (Admin only)',
    description:
      'Effective instance_configs.vectorSearch subjects, or the code defaults when none are stored.',
  })
  @ApiResponse({ status: 200, type: [InstanceVectorSubjectResponseDto] })
  async listVectorSubjects(): Promise<{
    message: string;
    data: InstanceVectorSubjectResponseDto[];
  }> {
    return {
      message: 'Vector subjects retrieved successfully',
      data: await this.subjectsService.listVectorSubjects(),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get subject by ID',
    description:
      'Retrieves a single subject with populated topics. Public endpoint.',
  })
  @ApiParam({ name: 'id', description: 'Subject ID' })
  @ApiResponse({
    status: 200,
    description: 'Subject retrieved successfully',
    type: SubjectResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Subject not found' })
  async findOne(@Param('id') id: string): Promise<{
    message: string;
    data: SubjectResponseDto;
  }> {
    const subject = await this.subjectsService.findOne(id);
    return {
      message: 'Subject retrieved successfully',
      data: subject,
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update subject (Admin only)',
    description: 'Updates an existing subject',
  })
  @ApiParam({ name: 'id', description: 'Subject ID' })
  @ApiResponse({
    status: 200,
    description: 'Subject updated successfully',
    type: SubjectResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Subject name already exists' })
  @ApiNotFoundResponse({ description: 'Subject not found' })
  @ApiUnauthorizedResponse({ description: 'Admin privileges required' })
  async update(
    @Param('id') id: string,
    @Body() updateSubjectDto: UpdateSubjectDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{
    message: string;
    data: SubjectResponseDto;
  }> {
    const subject = await this.subjectsService.update(
      id,
      updateSubjectDto,
      admin.id,
    );
    return {
      message: 'Subject updated successfully',
      data: subject,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete subject (Admin only)',
    description: 'Soft deletes a subject',
  })
  @ApiParam({ name: 'id', description: 'Subject ID' })
  @ApiResponse({
    status: 200,
    description: 'Subject deleted successfully',
    type: SubjectResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Subject not found' })
  @ApiUnauthorizedResponse({ description: 'Admin privileges required' })
  async remove(
    @Param('id') id: string,
    @GetUser() admin: UserResponseDto,
  ): Promise<{
    message: string;
    data: SubjectResponseDto;
  }> {
    const subject = await this.subjectsService.remove(id, admin.id);
    return {
      message: 'Subject deleted successfully',
      data: subject,
    };
  }
}
