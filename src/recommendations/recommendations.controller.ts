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
  ApiBody,
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
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CreateRecommendationOfferingDto } from './dto/create-recommendation-offering.dto';
import {
  RecommendationOfferingApiResponseDto,
  RecommendationOfferingsListApiResponseDto,
} from './dto/paginated-recommendation-offerings-response.dto';
import { RecommendationOfferingResponseDto } from './dto/recommendation-offering-response.dto';
import { UpdateRecommendationOfferingDto } from './dto/update-recommendation-offering.dto';
import { RecommendationKind } from './enums/recommendation-kind.enum';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a pathway recommendation offering (Admin)',
    description:
      'Creates a COURSE (or future INSTITUTION) offering under an exam with min/comfort percent thresholds.',
  })
  @ApiBody({ type: CreateRecommendationOfferingDto })
  @ApiCreatedResponse({ type: RecommendationOfferingApiResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async create(
    @Body() dto: CreateRecommendationOfferingDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{ message: string; data: RecommendationOfferingResponseDto }> {
    const data = await this.recommendationsService.create(dto, admin.id);
    return { message: 'Recommendation offering created successfully', data };
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List recommendation offerings (Admin)',
    description:
      'Paginated admin list. Filter by examId, kind, activeOnly, and title search.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'examId', required: false, type: String })
  @ApiQuery({ name: 'kind', required: false, enum: RecommendationKind })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiOkResponse({ type: RecommendationOfferingsListApiResponseDto })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('examId') examId?: string,
    @Query('kind') kind?: RecommendationKind,
    @Query('activeOnly', new DefaultValuePipe(false), ParseBoolPipe)
    activeOnly?: boolean,
    @Query('search') search?: string,
  ): Promise<RecommendationOfferingsListApiResponseDto> {
    const result = await this.recommendationsService.findAll(page, limit, {
      examId,
      kind,
      activeOnly,
      search,
    });
    return {
      message: 'Recommendation offerings retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a recommendation offering by id (Admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: RecommendationOfferingApiResponseDto })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async findOne(
    @Param('id') id: string,
  ): Promise<{ message: string; data: RecommendationOfferingResponseDto }> {
    const data = await this.recommendationsService.findOne(id);
    return { message: 'Recommendation offering retrieved successfully', data };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a recommendation offering (Admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: UpdateRecommendationOfferingDto })
  @ApiOkResponse({ type: RecommendationOfferingApiResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRecommendationOfferingDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<{ message: string; data: RecommendationOfferingResponseDto }> {
    const data = await this.recommendationsService.update(id, dto, admin.id);
    return { message: 'Recommendation offering updated successfully', data };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Soft-delete a recommendation offering (Admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: RecommendationOfferingApiResponseDto })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async remove(
    @Param('id') id: string,
    @GetUser() admin: UserResponseDto,
  ): Promise<{ message: string; data: RecommendationOfferingResponseDto }> {
    const data = await this.recommendationsService.remove(id, admin.id);
    return { message: 'Recommendation offering deleted successfully', data };
  }
}
