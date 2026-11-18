import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
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
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CreateEquationDto } from './dto/create-equation.dto';
import {
  EquationResponseDto,
  PaginatedEquationsResponseDto,
} from './dto/equation-response.dto';
import { UpdateEquationDto } from './dto/update-equation.dto';
import { EquationBookService } from './equation-book.service';

@ApiTags('equation-book')
@Controller('equation-book')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class EquationBookController {
  constructor(private readonly equationBookService: EquationBookService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an equation (Admin only)' })
  @ApiOkResponse({ type: EquationResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or subject/topic/exam refs invalid',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async create(
    @Body() dto: CreateEquationDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{ message: string; data: EquationResponseDto }> {
    const data = await this.equationBookService.create(dto, admin.id);
    return { message: 'Equation created successfully', data };
  }

  @Get()
  @ApiOperation({
    summary: 'List equations with pagination and filters',
    description:
      'Supports examId, subjectId, topicId, and title search. Soft-deleted rows are excluded.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'examId', required: false, type: String })
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiQuery({ name: 'topicId', required: false, type: String })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Case-insensitive title search',
  })
  @ApiOkResponse({ type: PaginatedEquationsResponseDto })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('examId') examId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('topicId') topicId?: string,
    @Query('search') search?: string,
  ): Promise<{
    message: string;
    data: EquationResponseDto[];
    pagination: PaginatedEquationsResponseDto['pagination'];
  }> {
    const result = await this.equationBookService.findAll(page, limit, {
      examId,
      subjectId,
      topicId,
      search,
    });
    return {
      message: 'Equations retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one equation by ID' })
  @ApiParam({ name: 'id', description: 'Equation ID' })
  @ApiOkResponse({ type: EquationResponseDto })
  @ApiNotFoundResponse({ description: 'Equation not found' })
  async findOne(
    @Param('id') id: string,
  ): Promise<{ message: string; data: EquationResponseDto }> {
    const data = await this.equationBookService.findOne(id);
    return { message: 'Equation retrieved successfully', data };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update an equation (Admin only)' })
  @ApiParam({ name: 'id', description: 'Equation ID' })
  @ApiOkResponse({ type: EquationResponseDto })
  @ApiNotFoundResponse({ description: 'Equation not found' })
  @ApiBadRequestResponse({
    description: 'Validation failed or subject/topic/exam refs invalid',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEquationDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{ message: string; data: EquationResponseDto }> {
    const data = await this.equationBookService.update(id, dto, admin.id);
    return { message: 'Equation updated successfully', data };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Soft-delete an equation (Admin only)' })
  @ApiParam({ name: 'id', description: 'Equation ID' })
  @ApiNotFoundResponse({ description: 'Equation not found' })
  async remove(
    @Param('id') id: string,
    @GetUser() admin: UserResponseDto,
  ): Promise<{ message: string }> {
    return this.equationBookService.remove(id, admin.id);
  }
}
