import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { COUNSELING_DEFAULT_LIMIT } from './counseling.constants';
import { CounselingService } from './counseling.service';
import {
  CounselingListApiResponseDto,
  CounselingStatusUpdatedApiResponseDto,
} from './dto/counseling-response.dto';
import { UpdateCounselingStatusDto } from './dto/update-counseling-status.dto';
import { CounselingRequestStatus } from './enums/counseling-request-status.enum';

@ApiTags('admin-counseling')
@Controller('admin/counseling')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Admin role required' })
export class AdminCounselingController {
  constructor(private readonly counselingService: CounselingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List counseling requests (Admin)',
    description:
      'Newest first. Optional status filter. Paginated cards payload.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: COUNSELING_DEFAULT_LIMIT,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: CounselingRequestStatus,
  })
  @ApiOkResponse({ type: CounselingListApiResponseDto })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query(
      'limit',
      new DefaultValuePipe(COUNSELING_DEFAULT_LIMIT),
      ParseIntPipe,
    )
    limit: number,
    @Query(
      'status',
      new ParseEnumPipe(CounselingRequestStatus, { optional: true }),
    )
    status?: CounselingRequestStatus,
  ): Promise<CounselingListApiResponseDto> {
    const result = await this.counselingService.list(page, limit, status);
    return {
      message: 'Counseling requests retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Advance counseling request status (Admin)',
    description:
      'Sequential only: booked → acknowledged → responded → completed. No skip or reverse.',
  })
  @ApiOkResponse({ type: CounselingStatusUpdatedApiResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid transition or invalid id',
  })
  @ApiNotFoundResponse({ description: 'Counseling request not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCounselingStatusDto,
    @GetUser() admin: UserResponseDto,
  ): Promise<CounselingStatusUpdatedApiResponseDto> {
    const data = await this.counselingService.updateStatus(
      id,
      dto.status,
      admin.id,
    );
    return {
      message: 'Counseling request status updated successfully',
      data,
    };
  }
}
