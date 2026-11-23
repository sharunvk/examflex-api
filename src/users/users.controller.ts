import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  HttpStatus,
  HttpCode,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import {
  SetTargetExamsDto,
  TargetExamPromptQueryDto,
} from './dto/set-target-exams.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AllowIncompleteProfile } from '../auth/decorators/allow-incomplete-profile.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // -- Admin: user management -------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a user (Admin only)',
    description:
      'Manually creates a user account. In production, users are created automatically via OTP authentication.',
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Email or phone number already exists' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async create(@Body() createUserDto: CreateUserDto): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    const user = await this.usersService.create(createUserDto);
    return { message: 'User created successfully', data: user };
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all users (Admin only)',
    description: 'Retrieves all active users. Can be filtered by role.',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: UserRole,
    description: 'Filter by role',
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async findAll(@Query('role') role?: UserRole): Promise<{
    message: string;
    data: UserResponseDto[];
    count: number;
  }> {
    const users = role
      ? await this.usersService.findByRole(role)
      : await this.usersService.findAll();
    return {
      message: 'Users retrieved successfully',
      data: users,
      count: users.length,
    };
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user statistics (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async getUserStats(): Promise<{ message: string; data: unknown }> {
    const stats = await this.usersService.getUserStats();
    return { message: 'User statistics retrieved successfully', data: stats };
  }

  @Get('with-deleted')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all users including deleted (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'All users retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async findAllWithDeleted(): Promise<{
    message: string;
    data: UserResponseDto[];
    count: number;
  }> {
    const users = await this.usersService.findAllWithDeleted();
    return {
      message: 'All users (including deleted) retrieved successfully',
      data: users,
      count: users.length,
    };
  }

  // -- Authenticated user: self-service ---------------------------------------

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowIncompleteProfile()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get own profile',
    description:
      'Returns the full profile of the authenticated user, including extended fields ' +
      '(bio, location, preferences, interactions, membership tier, etc.).',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: UserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async getMyProfile(@GetUser() currentUser: UserResponseDto): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    // Re-fetch so the response always reflects the latest data,
    // including any async field updates (e.g. membershipTier from analytics).
    const user = await this.usersService.findOne(currentUser.id);
    return { message: 'Profile retrieved successfully', data: user };
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @AllowIncompleteProfile()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Soft-delete own account',
    description:
      'Marks the authenticated student as deleted, deactivates the account, and releases ' +
      'phone / email / Google identity so the same credentials can create a new account later. ' +
      'Attempt history remains on the old user id (soft-delete v1).',
  })
  @ApiResponse({
    status: 200,
    description: 'Account soft-deleted successfully',
    type: UserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async softDeleteMe(@GetUser() currentUser: UserResponseDto): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    const user = await this.usersService.softDeleteMe(currentUser.id);
    return { message: 'Account deleted successfully', data: user };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update own profile',
    description:
      'Single endpoint to update the name and extended profile fields (bio, avatar, date of birth, gender, location, target exam). ' +
      'Only the fields provided in the request body are updated. Email is not accepted here (400 EMAIL_VERIFICATION_REQUIRED): ' +
      'add one with POST /users/me/email/verify after an email OTP.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed, or an email was sent (EMAIL_VERIFICATION_REQUIRED)',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async updateMe(
    @GetUser() currentUser: UserResponseDto,
    @Body() dto: UpdateMeDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const user = await this.usersService.updateMe(currentUser.id, dto);
    return { message: 'Profile updated successfully', data: user };
  }

  @Patch('me/preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update own preferences and interactions',
    description:
      'Updates study time preference, weekly goal, notification settings, and ' +
      'interaction signals (liked/disliked topics, interested subjects/exams).',
  })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async updateMyPreferences(
    @GetUser() currentUser: UserResponseDto,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const user = await this.usersService.updatePreferences(currentUser.id, dto);
    return { message: 'Preferences updated successfully', data: user };
  }

  @Put('me/target-exams')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Replace own target exams',
    description:
      'Sets the ordered list of exams the learner is preparing for. The first exam is the primary target. Send an empty list to clear them. At most 5 exams.',
  })
  @ApiResponse({
    status: 200,
    description: 'Target exams updated',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid exam id, unknown exam, or more than 5 exams',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async setMyTargetExams(
    @GetUser() currentUser: UserResponseDto,
    @Body() dto: SetTargetExamsDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const user = await this.usersService.setTargetExams(
      currentUser.id,
      dto.examIds,
    );
    return { message: 'Target exams updated', data: user };
  }

  @Get('me/target-exams/prompt')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Whether to ask the learner to target this exam',
    description:
      'False when the exam is already a target, the list is full, the exam is inactive, it was dismissed in the last 14 days, or it has been dismissed 3 times.',
  })
  @ApiQuery({ name: 'examId', required: true, description: 'Exam id' })
  @ApiResponse({ status: 200, description: 'Prompt decision' })
  @ApiBadRequestResponse({ description: 'examId is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async shouldPromptForTargetExam(
    @GetUser() currentUser: UserResponseDto,
    @Query() query: TargetExamPromptQueryDto,
  ): Promise<{ shouldPrompt: boolean }> {
    return this.usersService.shouldPromptForTargetExam(
      currentUser.id,
      query.examId,
    );
  }

  @Post('me/target-exams/:examId/dismiss-prompt')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remember that the learner skipped the target-exam prompt',
  })
  @ApiResponse({ status: 200, description: 'Prompt dismissed' })
  @ApiBadRequestResponse({ description: 'Invalid exam id' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async dismissTargetExamPrompt(
    @GetUser() currentUser: UserResponseDto,
    @Param('examId') examId: string,
  ): Promise<{ message: string }> {
    await this.usersService.dismissTargetExamPrompt(currentUser.id, examId);
    return { message: 'Target exam prompt dismissed' };
  }

  @Post('me/target-exams/:examId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add one target exam',
    description:
      'Appends the exam. Adding an exam that is already targeted does nothing. Returns 409 when the learner already has 5 target exams.',
  })
  @ApiResponse({
    status: 200,
    description: 'Target exam added',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid or inactive exam' })
  @ApiConflictResponse({ description: 'Target exam list is full' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async addMyTargetExam(
    @GetUser() currentUser: UserResponseDto,
    @Param('examId') examId: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const user = await this.usersService.addTargetExam(currentUser.id, examId);
    return { message: 'Target exam added', data: user };
  }

  @Delete('me/target-exams/:examId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove one target exam',
    description:
      'Removes the exam from the ordered list. The new first exam becomes the primary target.',
  })
  @ApiResponse({
    status: 200,
    description: 'Target exam removed',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid exam id' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async removeMyTargetExam(
    @GetUser() currentUser: UserResponseDto,
    @Param('examId') examId: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const user = await this.usersService.removeTargetExam(
      currentUser.id,
      examId,
    );
    return { message: 'Target exam removed', data: user };
  }

  // -- Admin: individual user operations -------------------------------------

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user by ID (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: UserResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async findOne(@Param('id') id: string): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    const user = await this.usersService.findOne(id);
    return { message: 'User retrieved successfully', data: user };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user by ID (Admin only)',
    description:
      'Allows admins to update any user core fields including role and active status.',
  })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Email or phone number already in use' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const user = await this.usersService.update(id, updateUserDto);
    return { message: 'User updated successfully', data: user };
  }

  @Patch(':id/toggle-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle user active status (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'User status toggled successfully',
    type: UserResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async toggleStatus(@Param('id') id: string): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    const user = await this.usersService.toggleUserStatus(id);
    return {
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: user,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a user (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'User soft-deleted successfully',
    type: UserResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async softDelete(@Param('id') id: string): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    const user = await this.usersService.softDelete(id);
    return { message: 'User deleted successfully', data: user };
  }

  @Post(':id/restore')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore a soft-deleted user (Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'User restored successfully',
    type: UserResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Deleted user not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async restore(@Param('id') id: string): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    const user = await this.usersService.restore(id);
    return { message: 'User restored successfully', data: user };
  }

  @Delete(':id/hard')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Permanently delete a user (Admin only)' })
  @ApiResponse({ status: 204, description: 'User permanently deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async hardDelete(@Param('id') id: string): Promise<void> {
    await this.usersService.hardDelete(id);
  }
}
