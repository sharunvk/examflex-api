import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CounselingService } from './counseling.service';
import { CreateCounselingRequestDto } from './dto/create-counseling-request.dto';
import {
  CounselingCreatedApiResponseDto,
  CounselingMeApiResponseDto,
} from './dto/counseling-response.dto';

@ApiTags('counseling')
@Controller('counseling')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
export class CounselingController {
  constructor(private readonly counselingService: CounselingService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get my counseling booking status',
    description:
      'Returns whether the signed-in learner can request a 1:1 session, ' +
      'and the active request when one exists. Extensible for future fields.',
  })
  @ApiOkResponse({ type: CounselingMeApiResponseDto })
  async getMe(
    @GetUser() currentUser: UserResponseDto,
  ): Promise<CounselingMeApiResponseDto> {
    const data = await this.counselingService.getMe(currentUser.id);
    return { message: 'Counseling status retrieved successfully', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Request a 1:1 counseling session',
    description:
      'Creates a counseling request for the signed-in learner. ' +
      'Rejected with 409 when an active request already exists.',
  })
  @ApiCreatedResponse({ type: CounselingCreatedApiResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or contact channel missing',
  })
  @ApiConflictResponse({
    description: 'Learner already has an active counseling request',
  })
  async create(
    @GetUser() currentUser: UserResponseDto,
    @Body() dto: CreateCounselingRequestDto,
  ): Promise<CounselingCreatedApiResponseDto> {
    const data = await this.counselingService.create(currentUser, dto);
    return { message: 'Counseling session requested successfully', data };
  }
}
