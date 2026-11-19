import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AttemptQuestion,
  AttemptSession,
  MockTestAttempt,
  MockTestAttemptDocument,
} from './schemas/mock-test-attempt.schema';
import {
  MockTest,
  MockTestDocument,
} from '../mock-tests/schemas/mock-test.schema';
import { Question, QuestionDocument } from './schemas/question.schema';
import { StartAttemptDto } from './dto/start-attempt.dto';
import { StartAttemptResponseDto } from './dto/start-attempt-response.dto';
import { UpdateAnswerDto } from './dto/update-answer.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitAttemptResponseDto } from './dto/submit-attempt-response.dto';
import { CompleteSessionResponseDto } from './dto/complete-session-response.dto';
import { AttemptDetailResponseDto } from './dto/attempt-detail-response.dto';
import { ResumeAttemptResponseDto } from './dto/resume-attempt-response.dto';
import { PauseAttemptResponseDto } from './dto/pause-attempt-response.dto';
import { UserAttemptSummaryDto } from './dto/user-attempt-summary.dto';
import { PopulatedDocument } from '../common/types/populated-document.interface';
import { knownPaperType } from '../common/enums/paper-type.enum';
import { ImageLike, ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalysisService } from '../analysis/analysis.service';
import { mapPerformanceBands } from '../exams/performance-bands';
import { AccessControlService } from '../access/access-control.service';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import { MistakeBookService } from '../mistake-book/mistake-book.service';
import { TodayService } from '../today/today.service';

@Injectable()
export class MockTestAttemptsService {
  private readonly logger = new Logger(MockTestAttemptsService.name);

  constructor(
    @InjectModel(MockTestAttempt.name)
    private attemptModel: Model<MockTestAttemptDocument>,
    @InjectModel(MockTest.name)
    private mockTestModel: Model<MockTestDocument>,
    @InjectModel(Question.name)
    private questionModel: Model<QuestionDocument>,
    private readonly imageUrlResolver: ImageUrlResolver,
    private readonly analyticsService: AnalyticsService,
    private readonly analysisService: AnalysisService,
    private readonly accessControlService: AccessControlService,
    private readonly mistakeBookService: MistakeBookService,
    private readonly todayService: TodayService,
  ) {}

  /**
   * Drop the cached dashboard/activity/analysis/today payloads once an attempt is
   * closed so the student sees the finished test straight away.
   */
  private async refreshAnalytics(userId: string): Promise<void> {
    try {
      await Promise.all([
        this.analyticsService.invalidateDashboardCache(userId),
        this.analysisService.invalidateUserAnalysis(userId),
        this.todayService.invalidateUserToday(userId),
      ]);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate analytics cache for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Sync Mistake Book after a paper closes (wrong + unattended). */
  private async syncMistakeBook(attemptId: string): Promise<void> {
    try {
      await this.mistakeBookService.replaceForAttempt(attemptId);
    } catch (error) {
      this.logger.warn(
        `Failed to sync Mistake Book for attempt ${attemptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private getCurrentSession(
    attempt: MockTestAttemptDocument,
  ): AttemptSession | null {
    if (!attempt.isSessionWise || !attempt.sessions?.length) {
      return null;
    }
    return attempt.sessions[attempt.currentSessionIndex] || null;
  }

  private getAllowedTimeSeconds(attempt: MockTestAttemptDocument): number {
    const session = this.getCurrentSession(attempt);
    if (session) {
      return session.durationInMinutes * 60;
    }
    return attempt.durationInMinutes * 60;
  }

  private getMarksForQuestion(
    attempt: MockTestAttemptDocument,
    attemptQuestion: AttemptQuestion,
  ): { marks: number; negative: number } {
    return {
      marks: attemptQuestion.marksPerQuestion ?? attempt.marksPerQuestion,
      negative: attemptQuestion.negativeMarking ?? attempt.negativeMarking,
    };
  }

  private getTotalPossibleScore(attempt: MockTestAttemptDocument): number {
    return attempt.questions.reduce((sum, question) => {
      return sum + (question.marksPerQuestion ?? attempt.marksPerQuestion);
    }, 0);
  }

  private sessionFields(attempt: MockTestAttemptDocument) {
    if (!attempt.isSessionWise) {
      return {};
    }
    return {
      currentSessionIndex: attempt.currentSessionIndex,
      sessions: (attempt.sessions || []).map(s => this.mapSessionDto(s)),
    };
  }

  private mapSessionDto(session: AttemptSession) {
    const questionIds = (session.questionIds || []).map(id => id.toString());
    return {
      subject: session.subject?.toString(),
      name: session.name,
      order: session.order,
      durationInMinutes: session.durationInMinutes,
      startIndex: session.startIndex,
      endIndex: session.endIndex,
      questionIds: questionIds.length ? questionIds : undefined,
      questionCount: questionIds.length
        ? questionIds.length
        : session.endIndex >= session.startIndex
          ? session.endIndex - session.startIndex + 1
          : 0,
      status: session.status,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      timeConsumed: session.timeConsumed || 0,
    };
  }

  private isQuestionInSession(
    attempt: MockTestAttemptDocument,
    session: AttemptSession,
    questionId: string,
    questionIndex: number,
  ): boolean {
    if (session.questionIds?.length) {
      return session.questionIds.some(id => id.toString() === questionId);
    }
    const locked = attempt.questions[questionIndex];
    if (locked?.sessionOrder != null) {
      return locked.sessionOrder === session.order;
    }
    return (
      questionIndex >= session.startIndex && questionIndex <= session.endIndex
    );
  }

  private sessionOrderForIndex(
    subjectConfig: Array<{
      questionStartIndex: number;
      questionEndIndex: number;
      questionIds?: Types.ObjectId[];
    }>,
    questionId: string,
    index: number,
  ): number | undefined {
    const byId = subjectConfig.findIndex(config =>
      (config.questionIds || []).some(id => id.toString() === questionId),
    );
    if (byId >= 0) {
      return byId;
    }
    const byRange = subjectConfig.findIndex(
      config =>
        index >= config.questionStartIndex && index <= config.questionEndIndex,
    );
    return byRange >= 0 ? byRange : undefined;
  }

  /**
   * Helper: Calculate total time elapsed for an attempt
   * Accounts for accumulated timeConsumed from previous pause/resume cycles.
   * Session-wise papers use the current session timer only.
   */
  private calculateTimeElapsed(attempt: MockTestAttemptDocument): number {
    const session = this.getCurrentSession(attempt);
    if (session) {
      if (
        attempt.status === 'PAUSED' ||
        session.status === 'PAUSED' ||
        session.status === 'SUBMITTED' ||
        session.status === 'EXPIRED' ||
        session.status === 'LOCKED'
      ) {
        return session.timeConsumed || 0;
      }
      const started = session.startedAt || attempt.startedAt;
      const currentSessionTime = Math.floor(
        (Date.now() - started.getTime()) / 1000,
      );
      return (session.timeConsumed || 0) + currentSessionTime;
    }

    // Once paused or closed the timer is frozen at the persisted value
    if (
      attempt.status === 'PAUSED' ||
      attempt.status === 'SUBMITTED' ||
      attempt.status === 'EXPIRED'
    ) {
      return attempt.timeConsumed || 0;
    }

    // For IN_PROGRESS: accumulated time + current session time
    const currentSessionTime = Math.floor(
      (Date.now() - attempt.startedAt.getTime()) / 1000,
    );
    return (attempt.timeConsumed || 0) + currentSessionTime;
  }

  /**
   * Helper: Time consumed on the whole paper in seconds.
   * Session-wise papers add the already finished sessions to the live timer of
   * the current session, so a full mock reports the time for every section.
   * Each session is capped at its own duration so abandoned attempts (expired
   * hours later) cannot report more than the paper allowed.
   */
  private calculateTotalTimeConsumed(
    attempt: MockTestAttemptDocument,
    elapsedOverride?: number,
  ): number {
    const current = this.getCurrentSession(attempt);
    const elapsed = elapsedOverride ?? this.calculateTimeElapsed(attempt);

    if (!current) {
      return Math.min(elapsed, this.getAllowedTimeSeconds(attempt));
    }

    const finished = (attempt.sessions || []).reduce(
      (total, session, index) => {
        if (index === attempt.currentSessionIndex) {
          return total;
        }
        const cap = session.durationInMinutes * 60;
        return total + Math.min(session.timeConsumed || 0, cap);
      },
      0,
    );

    const currentConsumed = Math.min(elapsed, current.durationInMinutes * 60);

    return finished + currentConsumed;
  }

  /**
   * Helper: Persist the final paper time on the attempt root so analytics and
   * the results screen can read it after the attempt is closed.
   * `elapsedOverride` must be the elapsed value captured before the status was
   * changed, because a closed attempt no longer has a running timer.
   */
  private persistTotalTimeConsumed(
    attempt: MockTestAttemptDocument,
    elapsedOverride?: number,
  ): number {
    const total = Math.floor(
      this.calculateTotalTimeConsumed(attempt, elapsedOverride),
    );
    attempt.timeConsumed = total;
    return total;
  }

  /**
   * Helper: Time taken on a closed attempt.
   * Attempts finished before the paper time was persisted fall back to the
   * section totals, then to the wall clock between start and submission.
   */
  private getCompletedTimeTaken(attempt: MockTestAttemptDocument): number {
    if (attempt.timeConsumed > 0) {
      return attempt.timeConsumed;
    }

    const sessionTotal = (attempt.sessions || []).reduce(
      (total, session) =>
        total +
        Math.min(session.timeConsumed || 0, session.durationInMinutes * 60),
      0,
    );
    if (sessionTotal > 0) {
      return sessionTotal;
    }

    if (!attempt.submittedAt || !attempt.startedAt) {
      return 0;
    }
    const wallClock = Math.floor(
      (attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 1000,
    );
    return Math.max(0, Math.min(wallClock, attempt.durationInMinutes * 60));
  }

  /**
   * Helper: Auto-expire and evaluate an attempt if time limit exceeded
   * @param attempt - The attempt document
   * @returns true if attempt was auto-expired, false otherwise
   */
  private async scoreAttempt(
    attempt: MockTestAttemptDocument,
  ): Promise<number> {
    const questionIds = attempt.questions.map(q => q.question);
    const questions = await this.questionModel
      .find({ _id: { $in: questionIds } })
      .lean()
      .exec();

    const questionMap = new Map(questions.map(q => [q._id.toString(), q]));

    let totalScore = 0;
    for (const attemptQuestion of attempt.questions) {
      const questionId = attemptQuestion.question.toString();
      const question = questionMap.get(questionId);

      if (!question) continue;

      const selectedOption = attemptQuestion.selectedOption;
      const correctAnswer = question.correctAnswer;
      const { marks, negative } = this.getMarksForQuestion(
        attempt,
        attemptQuestion,
      );

      if (!selectedOption) {
        attemptQuestion.isCorrect = false;
        attemptQuestion.marksAwarded = 0;
      } else if (selectedOption === correctAnswer) {
        attemptQuestion.isCorrect = true;
        attemptQuestion.marksAwarded = marks;
        totalScore += marks;
      } else {
        attemptQuestion.isCorrect = false;
        attemptQuestion.marksAwarded = -negative;
        totalScore -= negative;
      }
    }

    return totalScore;
  }

  private async autoExpireIfNeeded(
    attempt: MockTestAttemptDocument,
  ): Promise<boolean> {
    if (attempt.status !== 'IN_PROGRESS') {
      return false; // Already completed or paused
    }

    const timeElapsed = this.calculateTimeElapsed(attempt);
    const allowedTime = this.getAllowedTimeSeconds(attempt);

    if (timeElapsed <= allowedTime) {
      return false; // Still within time limit
    }

    const session = this.getCurrentSession(attempt);
    if (session && session.status === 'IN_PROGRESS') {
      session.status = 'EXPIRED';
      session.timeConsumed = allowedTime;
      session.submittedAt = new Date();
      this.persistTotalTimeConsumed(attempt, allowedTime);

      const isLast =
        attempt.currentSessionIndex >= (attempt.sessions?.length || 1) - 1;
      if (!isLast) {
        this.logger.warn(
          `Session ${attempt.currentSessionIndex} expired on attempt ${attempt.id}`,
        );
        await attempt.save();
        return false;
      }
    }

    this.logger.warn(
      `Auto-expiring abandoned attempt ${attempt.id} (exceeded by ${Math.floor(timeElapsed - allowedTime)}s)`,
    );

    attempt.score = await this.scoreAttempt(attempt);
    this.persistTotalTimeConsumed(attempt, timeElapsed);
    attempt.status = 'EXPIRED';
    attempt.submittedAt = new Date();
    await attempt.save();
    await this.refreshAnalytics(attempt.user.toString());
    await this.syncMistakeBook(attempt.id);

    return true;
  }

  /**
   * Start a new mock test attempt
   * @param startAttemptDto - Contains mockTestId
   * @param userId - ID of the authenticated user
   * @returns Attempt details with safe questions (no answers)
   */
  async startAttempt(
    startAttemptDto: StartAttemptDto,
    userId: string,
  ): Promise<StartAttemptResponseDto> {
    const { mockTestId } = startAttemptDto;

    // Step 1: Validate mock test ID format
    if (!Types.ObjectId.isValid(mockTestId)) {
      throw new BadRequestException('Invalid mock test ID format');
    }

    // Step 2: Fetch the mock test with populated exam, subject, and topic
    const test = await this.mockTestModel
      .findById(mockTestId)
      .populate(
        'exam',
        '_id name description hasMultiLingualSupport performanceBands',
      )
      .populate('subject', '_id name description')
      .populate('topic', '_id name')
      .exec();

    if (!test) {
      throw new NotFoundException(
        `Mock test with ID "${mockTestId}" not found`,
      );
    }

    if (!test.isActive) {
      throw new BadRequestException(
        'This mock test is currently not available',
      );
    }

    // Step 2b: Entitlement gate (D-08 / D-13). Resume/submit do not re-check.
    const access = await this.accessControlService.canAccessMockTest(
      userId,
      mockTestId,
    );
    if (!access.allowed) {
      this.logger.warn(
        `startAttempt denied mockTestId=${mockTestId} reason=${access.reason}`,
      );
      throw new ForbiddenException({
        message: 'An active entitlement is required to start this mock test',
        details: { code: AccessDecisionReason.ENTITLEMENT_REQUIRED },
      });
    }

    // Step 3: Check if retakes are allowed
    if (!test.allowRetake) {
      const existingAttempt = await this.attemptModel
        .findOne({
          user: new Types.ObjectId(userId),
          mockTest: new Types.ObjectId(mockTestId),
          status: { $in: ['SUBMITTED', 'IN_PROGRESS'] },
        })
        .exec();

      if (existingAttempt) {
        throw new ConflictException(
          'You have already attempted this test. Retakes are not allowed.',
        );
      }
    }

    // Step 4: Check for existing IN_PROGRESS attempt and auto-expire if needed
    const inProgressAttempt = await this.attemptModel
      .findOne({
        user: new Types.ObjectId(userId),
        mockTest: new Types.ObjectId(mockTestId),
        status: 'IN_PROGRESS',
      })
      .exec();

    if (inProgressAttempt) {
      // Auto-expire if time exceeded
      const wasExpired = await this.autoExpireIfNeeded(inProgressAttempt);

      if (!wasExpired) {
        // Still active - block new attempt
        throw new ConflictException(
          'You already have an in-progress attempt for this test. Please complete or submit it first.',
        );
      }
      // If expired, allow starting new attempt
    }

    // Step 5: Create the attempt with frozen configuration
    const subjectConfig = test.subjectConfig || [];
    const now = new Date();
    const paperQuestionIds = test.questionIds;
    const attemptQuestions = paperQuestionIds.map((q, i) => {
      const config =
        subjectConfig.find(c =>
          (c.questionIds || []).some(id => id.toString() === q.toString()),
        ) ||
        subjectConfig.find(
          c => i >= c.questionStartIndex && i <= c.questionEndIndex,
        );
      const sessionOrder =
        subjectConfig.length > 0
          ? this.sessionOrderForIndex(subjectConfig, q.toString(), i)
          : undefined;
      return {
        question: q,
        selectedOption: null,
        isCorrect: null,
        marksAwarded: 0,
        marksPerQuestion: config?.marksPerQuestion ?? test.marksPerQuestion,
        negativeMarking: config
          ? config.hasNegativeMarking
            ? config.negativeMarksPerQuestion
            : 0
          : test.negativeMarking,
        sessionOrder,
      };
    });
    const attempt = await this.attemptModel.create({
      user: new Types.ObjectId(userId),
      mockTest: test._id,
      testTitle: test.title,
      totalQuestions: test.totalQuestions,
      durationInMinutes: test.durationInMinutes,
      exam: test.exam,
      paperType: knownPaperType(test.paperType),
      subject: test.subject,
      topic: test.topic,
      marksPerQuestion: test.marksPerQuestion,
      negativeMarking: test.negativeMarking,
      passingScore: test.passingScore,
      shuffleOptions: test.shuffleOptions,
      showResultsImmediately: test.showResultsImmediately,
      difficultyDistribution: test.difficultyDistribution,
      questions: attemptQuestions,
      startedAt: now,
      status: 'IN_PROGRESS',
      isSessionWise: !!test.isSessionWise,
      currentSessionIndex: 0,
      sessions: test.isSessionWise
        ? subjectConfig.map((config, order) => {
            const fromIds = (config.questionIds || []).map(id => id);
            const fromRange = paperQuestionIds.slice(
              config.questionStartIndex,
              config.questionEndIndex + 1,
            );
            const sessionQuestionIds = fromIds.length ? fromIds : fromRange;
            return {
              subject: config.subject,
              name: config.name,
              order,
              durationInMinutes: config.sessionTime || 0,
              startIndex: config.questionStartIndex,
              endIndex: config.questionEndIndex,
              questionIds: sessionQuestionIds,
              status: order === 0 ? 'IN_PROGRESS' : 'LOCKED',
              startedAt: order === 0 ? now : undefined,
              timeConsumed: 0,
            };
          })
        : undefined,
    });

    const lockedRows = await this.loadLockedQuestionRows(
      attempt.questions,
      true,
    );

    // Step 7: Format response with simplified image data (only URLs)
    // Extract populated data
    const examDoc = test.exam as unknown as PopulatedDocument;
    const subjectDoc = test.subject as unknown as PopulatedDocument;
    const topicDoc = test.topic as unknown as PopulatedDocument;

    const response: StartAttemptResponseDto = {
      attemptId: attempt.id,
      mockTestData: {
        title: test.title,
        durationInMinutes: test.durationInMinutes,
        totalQuestions: test.totalQuestions,
        startedAt: attempt.startedAt,
        marksPerQuestion: test.marksPerQuestion,
        negativeMarking: test.negativeMarking,
        passingScore: test.passingScore,
        paperType: knownPaperType(test.paperType),
        exam: {
          id: examDoc?._id?.toString() || '',
          name: examDoc?.name || '',
          description: examDoc?.description,
          hasMultiLingualSupport: Boolean(
            (
              examDoc as PopulatedDocument & {
                hasMultiLingualSupport?: boolean;
              }
            )?.hasMultiLingualSupport,
          ),
          performanceBands: mapPerformanceBands(examDoc?.performanceBands),
        },
        subject: subjectDoc?._id
          ? {
              id: subjectDoc._id.toString(),
              name: subjectDoc?.name || '',
              description: subjectDoc?.description,
            }
          : undefined,
        topic: topicDoc
          ? {
              id: topicDoc?._id?.toString() || '',
              name: topicDoc?.name || '',
            }
          : undefined,
        isSessionWise: !!attempt.isSessionWise,
        ...this.sessionFields(attempt),
      },
      questions: await this.mapAttemptQuestionsWithSession(
        lockedRows.map(row => row.question),
        lockedRows.map(row => row.aq),
      ),
    };

    return response;
  }

  /**
   * Pause an in-progress mock test attempt
   * @param attemptId - Attempt ID
   * @param userId - User ID
   * @returns Pause response with time consumed and remaining
   */
  async pauseAttempt(
    attemptId: string,
    userId: string,
  ): Promise<PauseAttemptResponseDto> {
    const GRACE_PERIOD_SECONDS = 10; // Allow 10 seconds grace period

    // Step 1: Validate attempt ID
    if (!Types.ObjectId.isValid(attemptId)) {
      throw new BadRequestException('Invalid attempt ID format');
    }

    // Step 2: Fetch attempt
    const attempt = await this.attemptModel
      .findOne({
        _id: attemptId,
        user: new Types.ObjectId(userId),
      })
      .exec();

    if (!attempt) {
      throw new NotFoundException(
        `Attempt with ID "${attemptId}" not found or you don't have access to it`,
      );
    }

    // Step 3: Validate attempt is IN_PROGRESS
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot pause attempt with status "${attempt.status}". Only IN_PROGRESS attempts can be paused.`,
      );
    }

    // Step 4: Freeze the running timer at the time actually consumed.
    // The grace period only makes the expiry check lenient for network delays;
    // it must not be added to the stored time or every pause would inflate it.
    const session = this.getCurrentSession(attempt);
    const timeElapsed = this.calculateTimeElapsed(attempt);
    const allowedTime = this.getAllowedTimeSeconds(attempt);
    const timerConsumed = Math.min(timeElapsed, allowedTime);
    const timeRemaining = Math.max(0, allowedTime - timeElapsed);

    // Step 5: Check if time has already expired
    if (timeElapsed + GRACE_PERIOD_SECONDS >= allowedTime) {
      throw new BadRequestException(
        'Cannot pause: Test time has already expired. Please submit the test.',
      );
    }

    // Step 6: Update attempt with paused state
    attempt.status = 'PAUSED';
    attempt.pausedAt = new Date();
    if (session) {
      session.status = 'PAUSED';
      session.timeConsumed = timerConsumed;
    }
    // Session-wise papers keep the paper total on the root and the section
    // timer on the session; single-timer papers use the root for both.
    const totalTimeConsumed = this.persistTotalTimeConsumed(
      attempt,
      timeElapsed,
    );

    // Add pause event to history
    attempt.pauseResumeHistory.push({
      action: 'PAUSE',
      timestamp: new Date(),
      timeConsumedAtPause: totalTimeConsumed,
    });

    await attempt.save();

    this.logger.log(
      `Attempt ${attemptId} paused by user ${userId}. Time consumed: ${totalTimeConsumed}s, Remaining: ${timeRemaining}s`,
    );

    // Step 7: Calculate pause count
    const pauseCount = attempt.pauseResumeHistory.filter(
      event => event.action === 'PAUSE',
    ).length;

    // Step 8: Build response
    const response: PauseAttemptResponseDto = {
      attemptId: attempt.id,
      testTitle: attempt.testTitle,
      status: 'PAUSED',
      timeConsumed: timerConsumed,
      totalTimeConsumed,
      timeRemaining,
      pausedAt: attempt.pausedAt,
      pauseCount,
      recentHistory: attempt.pauseResumeHistory.slice(-5).map(event => ({
        action: event.action,
        timestamp: event.timestamp,
        timeConsumedAtPause: event.timeConsumedAtPause,
      })),
    };

    return response;
  }

  /**
   * Get detailed attempt information (serves as resume/fallback endpoint)
   * @param attemptId - Attempt ID
   * @param userId - User ID
   * @returns Comprehensive attempt details with questions and progress, including exam, subject, and topic
   */
  async findOne(
    attemptId: string,
    userId: string,
  ): Promise<AttemptDetailResponseDto> {
    // Step 1: Validate attempt ID
    if (!Types.ObjectId.isValid(attemptId)) {
      throw new BadRequestException('Invalid attempt ID format');
    }

    // Step 2: Fetch attempt with populated exam, subject, and topic
    const attempt = await this.attemptModel
      .findOne({
        _id: attemptId,
        user: new Types.ObjectId(userId),
      })
      .populate(
        'exam',
        'name description hasMultiLingualSupport performanceBands',
      )
      .populate('subject', 'name description')
      .populate('topic', 'name description')
      .populate('mockTest', 'paperType')
      .exec();

    if (!attempt) {
      throw new NotFoundException(
        `Attempt with ID "${attemptId}" not found or you don't have access to it`,
      );
    }

    // Step 3: Auto-expire if needed (handles abandoned attempts)
    await this.autoExpireIfNeeded(attempt);

    // Step 4: Fetch full question details (with options)
    const orderedQuestions = await this.loadLockedQuestionRows(
      attempt.questions,
      false,
    );

    // Step 5: Calculate time metrics (using helper for accurate calculation)
    const timeElapsed = this.calculateTimeElapsed(attempt);
    const allowedTime = this.getAllowedTimeSeconds(attempt);
    const timeRemaining = Math.max(0, allowedTime - timeElapsed);

    // Step 6: Build response based on attempt status
    const isInProgress = attempt.status === 'IN_PROGRESS';
    const isPaused = attempt.status === 'PAUSED';
    const isSubmitted =
      attempt.status === 'SUBMITTED' || attempt.status === 'EXPIRED';
    const showResults = isSubmitted && attempt.showResultsImmediately;

    const mappedQuestions = (
      await this.mapAttemptQuestionsWithSession(
        orderedQuestions.map(row => row.question),
        orderedQuestions.map(row => row.aq),
      )
    ).map((questionDto, index) => {
      const { aq, question } = orderedQuestions[index];
      const next: Record<string, unknown> = { ...questionDto };
      if (aq.selectedOption) {
        next.selectedOption = aq.selectedOption;
      }
      if (showResults && question) {
        next.correctAnswer = question.correctAnswer;
        next.isCorrect = aq.isCorrect;
        next.marksAwarded = aq.marksAwarded;
      }
      return next;
    });

    if (showResults) {
      await Promise.all(
        mappedQuestions.map(async (questionDto, index) => {
          const explanation = orderedQuestions[index].question?.explanation;
          if (explanation) {
            questionDto.explanation = await this.mapExplanation(explanation);
          }
        }),
      );
    }

    // Step 8: Extract populated exam, subject, and topic data
    const examDoc = attempt.exam as unknown as PopulatedDocument & {
      name?: string;
      description?: string;
      hasMultiLingualSupport?: boolean;
    };

    const subjectDoc = attempt.subject as unknown as PopulatedDocument & {
      name?: string;
      description?: string;
    };

    const topicDoc = attempt.topic as unknown as
      | (PopulatedDocument & {
          name?: string;
          description?: string;
        })
      | undefined;

    // Step 9: Build base response
    const response: AttemptDetailResponseDto = {
      attemptId: attempt.id,
      status: attempt.status,
      test: {
        title: attempt.testTitle,
        durationInMinutes: attempt.durationInMinutes,
        totalQuestions: attempt.totalQuestions,
        startedAt: attempt.startedAt,
        marksPerQuestion: attempt.marksPerQuestion,
        negativeMarking: attempt.negativeMarking,
        passingScore: attempt.passingScore,
        showResultsImmediately: attempt.showResultsImmediately,
        paperType: knownPaperType(
          (attempt.mockTest as { paperType?: string } | null)?.paperType,
        ),
        exam: {
          id: (examDoc?._id as Types.ObjectId)?.toString() || '',
          name: examDoc?.name || '',
          description: examDoc?.description,
          hasMultiLingualSupport: Boolean(examDoc?.hasMultiLingualSupport),
          performanceBands: mapPerformanceBands(examDoc?.performanceBands),
        },
        subject: {
          id: (subjectDoc?._id as Types.ObjectId)?.toString() || '',
          name: subjectDoc?.name || '',
          description: subjectDoc?.description,
        },
        topic: topicDoc
          ? {
              id: (topicDoc._id as Types.ObjectId)?.toString() || '',
              name: topicDoc.name || '',
              description: topicDoc.description,
            }
          : undefined,
      },
      questions: mappedQuestions as never[],
      isSessionWise: !!attempt.isSessionWise,
      ...this.sessionFields(attempt),
    } as AttemptDetailResponseDto;

    // Step 10: Add time metrics for in-progress and paused attempts
    if (isInProgress || isPaused) {
      response.timeElapsed = timeElapsed;
      response.timeRemaining = timeRemaining;
    }

    // Step 11: Add results for submitted attempts
    if (isSubmitted) {
      response.score = attempt.score;
      response.totalScore = this.getTotalPossibleScore(attempt);
      response.submittedAt = attempt.submittedAt;
      response.timeTaken = this.getCompletedTimeTaken(attempt);

      // Calculate answer statistics
      let correctCount = 0;
      let incorrectCount = 0;
      let unansweredCount = 0;

      attempt.questions.forEach(q => {
        if (!q.selectedOption) {
          unansweredCount++;
        } else if (q.isCorrect) {
          correctCount++;
        } else {
          incorrectCount++;
        }
      });

      response.correctAnswers = correctCount;
      response.incorrectAnswers = incorrectCount;
      response.unansweredQuestions = unansweredCount;
      response.isPassed = attempt.passingScore
        ? attempt.score >= attempt.passingScore
        : false;
    }

    return response;
  }

  /**
   * Resume attempt (for reload/reconnection scenarios)
   * Returns questions with selected options but WITHOUT correct answers or explanations
   * @param attemptId - Attempt ID
   * @param userId - User ID
   * @returns Attempt details for resuming test
   */
  async resumeAttempt(
    attemptId: string,
    userId: string,
  ): Promise<ResumeAttemptResponseDto> {
    // Step 1: Validate attempt ID
    if (!Types.ObjectId.isValid(attemptId)) {
      throw new BadRequestException('Invalid attempt ID format');
    }

    // Step 2: Fetch attempt with populated exam, subject, and topic
    const attempt = await this.attemptModel
      .findOne({
        _id: attemptId,
        user: new Types.ObjectId(userId),
      })
      .populate(
        'exam',
        '_id name description hasMultiLingualSupport performanceBands',
      )
      .populate('subject', '_id name description')
      .populate('topic', '_id name')
      .populate('mockTest', 'paperType')
      .exec();

    if (!attempt) {
      throw new NotFoundException(
        `Attempt with ID "${attemptId}" not found or you don't have access to it`,
      );
    }

    // Step 3: Check if attempt should be auto-expired
    const wasExpired = await this.autoExpireIfNeeded(attempt);

    if (wasExpired) {
      throw new BadRequestException(
        'This attempt has expired due to time limit. Use GET /:id endpoint to view results.',
      );
    }

    // Step 4: Only allow resuming IN_PROGRESS or PAUSED attempts
    if (attempt.status !== 'IN_PROGRESS' && attempt.status !== 'PAUSED') {
      throw new BadRequestException(
        `Cannot resume attempt with status "${attempt.status}". Use GET /:id endpoint to view results.`,
      );
    }

    // Step 4.5: If resuming from PAUSED, update status and startedAt
    if (attempt.status === 'PAUSED') {
      attempt.status = 'IN_PROGRESS';
      attempt.startedAt = new Date(); // Reset startedAt for new session
      const pausedSession = this.getCurrentSession(attempt);
      if (pausedSession) {
        pausedSession.status = 'IN_PROGRESS';
        pausedSession.startedAt = attempt.startedAt;
      }

      // Add resume event to history
      attempt.pauseResumeHistory.push({
        action: 'RESUME',
        timestamp: new Date(),
      });

      await attempt.save();

      this.logger.log(
        `Attempt ${attemptId} resumed by user ${userId}. Time consumed: ${attempt.timeConsumed}s`,
      );
    }

    const orderedQuestions = await this.loadLockedQuestionRows(
      attempt.questions,
      true,
    );

    const mappedQuestions = (
      await this.mapAttemptQuestionsWithSession(
        orderedQuestions.map(row => row.question),
        orderedQuestions.map(row => row.aq),
      )
    ).map((questionDto, index) => {
      const selectedOption = orderedQuestions[index].aq.selectedOption;
      return selectedOption ? { ...questionDto, selectedOption } : questionDto;
    });

    const timeElapsed = this.calculateTimeElapsed(attempt);
    const allowedTime = this.getAllowedTimeSeconds(attempt);
    const timeRemaining = Math.max(0, allowedTime - timeElapsed);

    // Step 8: Build response with exam, subject, topic details
    const pauseCount = attempt.pauseResumeHistory.filter(
      event => event.action === 'PAUSE',
    ).length;

    // Extract populated data
    const examDoc = attempt.exam as any;
    const subjectDoc = attempt.subject as any;
    const topicDoc = attempt.topic as any;

    const response: ResumeAttemptResponseDto = {
      attemptId: attempt.id,
      mockTestData: {
        title: attempt.testTitle,
        durationInMinutes: attempt.durationInMinutes,
        totalQuestions: attempt.totalQuestions,
        startedAt: attempt.startedAt,
        marksPerQuestion: attempt.marksPerQuestion,
        negativeMarking: attempt.negativeMarking,
        passingScore: attempt.passingScore,
        paperType: knownPaperType(
          (attempt.mockTest as { paperType?: string } | null)?.paperType,
        ),
        exam: {
          id: examDoc?._id?.toString() || '',
          name: examDoc?.name || '',
          description: examDoc?.description,
          hasMultiLingualSupport: Boolean(
            (examDoc as { hasMultiLingualSupport?: boolean })
              ?.hasMultiLingualSupport,
          ),
          performanceBands: mapPerformanceBands(
            (examDoc as { performanceBands?: unknown })?.performanceBands,
          ),
        },
        subject: subjectDoc?._id
          ? {
              id: subjectDoc._id.toString(),
              name: subjectDoc?.name || '',
              description: subjectDoc?.description,
            }
          : undefined,
        topic: topicDoc
          ? {
              id: topicDoc?._id?.toString() || '',
              name: topicDoc?.name || '',
            }
          : undefined,
        isSessionWise: !!attempt.isSessionWise,
        ...this.sessionFields(attempt),
      },
      questions:
        mappedQuestions as unknown as ResumeAttemptResponseDto['questions'],
      timeElapsed,
      timeRemaining,
      pauseCount: pauseCount > 0 ? pauseCount : undefined,
      timeConsumed: attempt.timeConsumed > 0 ? attempt.timeConsumed : undefined,
      ...this.sessionFields(attempt),
    };

    return response;
  }

  /**
   * Get all attempts for a user
   * @param userId - User ID
   * @returns User's attempts with populated exam, subject, and topic
   */
  async findUserAttempts(userId: string): Promise<UserAttemptSummaryDto[]> {
    const attempts = await this.attemptModel
      .find({ user: new Types.ObjectId(userId) })
      .populate(
        'mockTest',
        'title totalQuestions durationInMinutes marksPerQuestion',
      )
      .populate('exam', 'name description hasMultiLingualSupport')
      .populate('subject', 'name description')
      .populate('topic', 'name description')
      .sort({ createdAt: -1 })
      .exec();

    // Auto-expire any abandoned IN_PROGRESS attempts
    for (const attempt of attempts) {
      await this.autoExpireIfNeeded(attempt);
    }

    return attempts.map(attempt => {
      const testDoc = attempt.mockTest as unknown as PopulatedDocument & {
        title?: string;
        totalQuestions?: number;
        marksPerQuestion?: number;
      };

      const examDoc = attempt.exam as unknown as PopulatedDocument & {
        name?: string;
        description?: string;
      };

      const subjectDoc = attempt.subject as unknown as PopulatedDocument & {
        name?: string;
        description?: string;
      };

      const topicDoc = attempt.topic as unknown as
        | (PopulatedDocument & {
            name?: string;
            description?: string;
          })
        | undefined;

      return {
        attemptId: attempt.id || attempt._id?.toString() || '',
        mockTestId:
          attempt.mockTest?._id?.toString() ||
          (typeof attempt.mockTest === 'string' ? attempt.mockTest : ''),
        mockTestTitle: testDoc.title || 'Unknown Test',
        exam: {
          id: (examDoc?._id as Types.ObjectId)?.toString() || '',
          name: examDoc?.name || '',
          description: examDoc?.description,
        },
        subject: {
          id: (subjectDoc?._id as Types.ObjectId)?.toString() || '',
          name: subjectDoc?.name || '',
          description: subjectDoc?.description,
        },
        topic: topicDoc
          ? {
              id: (topicDoc._id as Types.ObjectId)?.toString() || '',
              name: topicDoc.name || '',
              description: topicDoc.description,
            }
          : undefined,
        status: attempt.status,
        score: attempt.score,
        totalMarks:
          (testDoc.totalQuestions || 0) * (testDoc.marksPerQuestion || 0),
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
      };
    });
  }

  /**
   * Get user's attempts for a specific test
   * @param userId - User ID
   * @param mockTestId - Mock test ID
   * @returns User's attempts for the test with populated exam, subject, and topic
   */
  async findUserTestAttempts(
    userId: string,
    mockTestId: string,
  ): Promise<UserAttemptSummaryDto[]> {
    if (!Types.ObjectId.isValid(mockTestId)) {
      throw new BadRequestException('Invalid mock test ID format');
    }

    const attempts = await this.attemptModel
      .find({
        user: new Types.ObjectId(userId),
        mockTest: new Types.ObjectId(mockTestId),
      })
      .populate(
        'mockTest',
        'title totalQuestions durationInMinutes marksPerQuestion',
      )
      .populate('exam', 'name description hasMultiLingualSupport')
      .populate('subject', 'name description')
      .populate('topic', 'name description')
      .sort({ createdAt: -1 })
      .exec();

    // Auto-expire any abandoned IN_PROGRESS attempts
    for (const attempt of attempts) {
      await this.autoExpireIfNeeded(attempt);
    }

    return attempts.map(attempt => {
      const testDoc = attempt.mockTest as unknown as PopulatedDocument & {
        title?: string;
        totalQuestions?: number;
        marksPerQuestion?: number;
      };

      const examDoc = attempt.exam as unknown as PopulatedDocument & {
        name?: string;
        description?: string;
      };

      const subjectDoc = attempt.subject as unknown as PopulatedDocument & {
        name?: string;
        description?: string;
      };

      const topicDoc = attempt.topic as unknown as
        | (PopulatedDocument & {
            name?: string;
            description?: string;
          })
        | undefined;

      return {
        attemptId: attempt.id || attempt._id?.toString() || '',
        mockTestId:
          attempt.mockTest?._id?.toString() ||
          (typeof attempt.mockTest === 'string' ? attempt.mockTest : ''),
        mockTestTitle: testDoc.title || 'Unknown Test',
        exam: {
          id: (examDoc?._id as Types.ObjectId)?.toString() || '',
          name: examDoc?.name || '',
          description: examDoc?.description,
        },
        subject: {
          id: (subjectDoc?._id as Types.ObjectId)?.toString() || '',
          name: subjectDoc?.name || '',
          description: subjectDoc?.description,
        },
        topic: topicDoc
          ? {
              id: (topicDoc._id as Types.ObjectId)?.toString() || '',
              name: topicDoc.name || '',
              description: topicDoc.description,
            }
          : undefined,
        status: attempt.status,
        score: attempt.score,
        totalMarks:
          (testDoc.totalQuestions || 0) * (testDoc.marksPerQuestion || 0),
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
      };
    });
  }

  /**
   * Update answer for a question in an attempt
   * @param attemptId - Attempt ID
   * @param userId - User ID
   * @param updateAnswerDto - Contains questionId and selectedOptionId. A null
   * selectedOptionId clears the answer, so scoring treats it as unanswered.
   * @returns Success indicator
   */
  async updateAnswer(
    attemptId: string,
    userId: string,
    updateAnswerDto: UpdateAnswerDto,
  ): Promise<void> {
    const { questionId, selectedOptionId } = updateAnswerDto;

    // Step 1: Validate attempt ID format
    if (!Types.ObjectId.isValid(attemptId)) {
      throw new BadRequestException('Invalid attempt ID format');
    }

    // Step 2: Validate question ID format
    if (!Types.ObjectId.isValid(questionId)) {
      throw new BadRequestException('Invalid question ID format');
    }

    // Step 3: Fetch the attempt
    const attempt = await this.attemptModel
      .findOne({
        _id: attemptId,
        user: new Types.ObjectId(userId),
      })
      .exec();

    if (!attempt) {
      throw new NotFoundException(
        `Attempt with ID "${attemptId}" not found or you don't have access to it`,
      );
    }

    // Step 4: Validate attempt status
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot update answers for attempt with status "${attempt.status}". Only IN_PROGRESS attempts can be updated.`,
      );
    }

    // Step 5: Check if attempt / current session has expired
    const timeElapsed = this.calculateTimeElapsed(attempt);
    const allowedTime = this.getAllowedTimeSeconds(attempt);

    if (timeElapsed > allowedTime) {
      const wasFullyExpired = await this.autoExpireIfNeeded(attempt);
      if (wasFullyExpired) {
        throw new BadRequestException(
          'Test has expired. You can no longer update answers.',
        );
      }
      throw new BadRequestException(
        'This session has expired. Complete the session to continue to the next subject.',
      );
    }

    const currentSession = this.getCurrentSession(attempt);
    if (currentSession && currentSession.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        'This session is not active. Complete it to continue, or resume the attempt.',
      );
    }

    // Step 6: Verify question exists in the attempt (and current session, if session-wise)
    const questionIndex = attempt.questions.findIndex(
      q => q.question.toString() === questionId,
    );

    if (questionIndex < 0) {
      throw new BadRequestException(
        `Question with ID "${questionId}" is not part of this attempt`,
      );
    }

    if (
      currentSession &&
      !this.isQuestionInSession(
        attempt,
        currentSession,
        questionId,
        questionIndex,
      )
    ) {
      throw new BadRequestException(
        'You can only answer questions in the current session',
      );
    }

    // Step 7: Update the selected answer using positional operator
    await this.attemptModel
      .updateOne(
        {
          _id: attemptId,
          'questions.question': new Types.ObjectId(questionId),
        },
        {
          $set: {
            'questions.$.selectedOption': selectedOptionId,
          },
        },
      )
      .exec();
  }

  /**
   * Submit attempt and evaluate results
   * @param attemptId - Attempt ID
   * @param userId - User ID
   * @param submitAttemptDto - Optional answers to update before submission
   * @returns Submission results with score and details
   */
  async submitAttempt(
    attemptId: string,
    userId: string,
    submitAttemptDto?: SubmitAttemptDto,
  ): Promise<SubmitAttemptResponseDto> {
    // Step 1: Validate attempt ID format
    if (!Types.ObjectId.isValid(attemptId)) {
      throw new BadRequestException('Invalid attempt ID format');
    }

    // Step 2: Fetch the attempt
    const attempt = await this.attemptModel
      .findOne({
        _id: attemptId,
        user: new Types.ObjectId(userId),
      })
      .exec();

    if (!attempt) {
      throw new NotFoundException(
        `Attempt with ID "${attemptId}" not found or you don't have access to it`,
      );
    }

    // Step 3: Validate attempt status
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot submit attempt with status "${attempt.status}". Only IN_PROGRESS attempts can be submitted.`,
      );
    }

    const currentSession = this.getCurrentSession(attempt);
    const isLastSession =
      !currentSession ||
      attempt.currentSessionIndex >= (attempt.sessions?.length || 1) - 1;
    if (currentSession && !isLastSession) {
      throw new BadRequestException(
        'This is a session-wise test. Complete the current session before submitting the paper.',
      );
    }

    // Step 4: Server-side timer check (using helper for accurate time calculation)
    const timeElapsed = this.calculateTimeElapsed(attempt);
    const allowedTime = this.getAllowedTimeSeconds(attempt);
    const GRACE_PERIOD_SECONDS = 10; // Allow 10 seconds for network delays
    // A session-wise paper reaches submit through completeSession, which has
    // already frozen the section timer, so trust that verdict as well.
    const isExpired =
      timeElapsed > allowedTime || currentSession?.status === 'EXPIRED';
    const exceededBySeconds = timeElapsed - allowedTime;
    const isWithinGracePeriod = exceededBySeconds <= GRACE_PERIOD_SECONDS;

    // If expired, mark as EXPIRED but continue to evaluate
    if (isExpired) {
      attempt.status = 'EXPIRED';
    }

    // Step 5: Optional - Update answers from request (protects against last-second internet loss)
    // Only accept answers if within time OR within grace period after expiry
    const shouldAcceptAnswers =
      !isExpired || (isExpired && isWithinGracePeriod);

    if (submitAttemptDto?.answers && submitAttemptDto.answers.length > 0) {
      if (shouldAcceptAnswers) {
        // Accept and process answers
        for (const answer of submitAttemptDto.answers) {
          if (!Types.ObjectId.isValid(answer.questionId)) {
            continue; // Skip invalid IDs
          }

          const questionIndex = attempt.questions.findIndex(
            q => q.question.toString() === answer.questionId,
          );
          if (questionIndex < 0) {
            continue;
          }
          if (
            currentSession &&
            !this.isQuestionInSession(
              attempt,
              currentSession,
              answer.questionId,
              questionIndex,
            )
          ) {
            continue;
          }

          await this.attemptModel
            .updateOne(
              {
                _id: attemptId,
                'questions.question': new Types.ObjectId(answer.questionId),
              },
              {
                $set: {
                  'questions.$.selectedOption': answer.selectedOptionId,
                },
              },
            )
            .exec();
        }

        // Refresh attempt after updates
        const updatedAttempt = await this.attemptModel
          .findById(attemptId)
          .exec();
        if (updatedAttempt) {
          attempt.questions = updatedAttempt.questions;
        }
      } else {
        // Reject answers - time exceeded beyond grace period
        this.logger.warn(
          `Attempt ${attemptId}: Answers rejected - timer exceeded by ${Math.floor(exceededBySeconds)} seconds (grace period: ${GRACE_PERIOD_SECONDS}s)`,
        );
      }
    }

    // Step 6: Fetch all questions with correct answers and explanations
    const questionIds = attempt.questions.map(q => q.question);
    const questions = await this.questionModel
      .find({ _id: { $in: questionIds } })
      .lean()
      .exec();

    // Create a map for quick lookup
    const questionMap = new Map(questions.map(q => [q._id.toString(), q]));

    // Step 7: Evaluate each question
    let totalScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    for (const attemptQuestion of attempt.questions) {
      const questionId = attemptQuestion.question.toString();
      const question = questionMap.get(questionId);

      if (!question) {
        continue; // Skip if question not found
      }

      const selectedOption = attemptQuestion.selectedOption;
      const correctAnswer = question.correctAnswer;

      const { marks, negative } = this.getMarksForQuestion(
        attempt,
        attemptQuestion,
      );

      if (!selectedOption) {
        // Unanswered - no marks, no negative marking
        attemptQuestion.isCorrect = false;
        attemptQuestion.marksAwarded = 0;
        unansweredCount++;
      } else if (selectedOption === correctAnswer) {
        // Correct answer
        attemptQuestion.isCorrect = true;
        attemptQuestion.marksAwarded = marks;
        totalScore += marks;
        correctCount++;
      } else {
        // Incorrect answer - apply negative marking
        attemptQuestion.isCorrect = false;
        attemptQuestion.marksAwarded = -negative;
        totalScore -= negative;
        incorrectCount++;
      }
    }

    // Step 8: Update attempt with final results
    const submittedAt = new Date();
    if (currentSession) {
      currentSession.status = isExpired ? 'EXPIRED' : 'SUBMITTED';
      currentSession.submittedAt = submittedAt;
      currentSession.timeConsumed = Math.min(timeElapsed, allowedTime);
    }
    attempt.score = totalScore;
    // Freeze the paper time before closing the attempt: analytics, the results
    // screen and the badge rules all read attempt.timeConsumed afterwards.
    const totalTimeConsumed = this.persistTotalTimeConsumed(
      attempt,
      timeElapsed,
    );
    attempt.status = isExpired ? 'EXPIRED' : 'SUBMITTED';
    attempt.submittedAt = submittedAt;

    await attempt.save();
    await this.refreshAnalytics(userId);
    await this.syncMistakeBook(attempt.id);

    // Step 9: Prepare response
    const totalPossibleScore = this.getTotalPossibleScore(attempt);
    const passed = attempt.passingScore
      ? totalScore >= attempt.passingScore
      : false;

    const response: SubmitAttemptResponseDto = {
      attemptId: attempt.id,
      score: totalScore,
      totalScore: totalPossibleScore,
      passingScore: attempt.passingScore,
      passed,
      correctAnswers: correctCount,
      incorrectAnswers: incorrectCount,
      unansweredQuestions: unansweredCount,
      submittedAt,
      timeTaken: totalTimeConsumed,
    };

    // Step 10: Include detailed results if showResultsImmediately is true
    if (attempt.showResultsImmediately) {
      response.questionResults = await Promise.all(
        attempt.questions.map(async aq => {
          const questionId = aq.question.toString();
          const question = questionMap.get(questionId);
          const explanation = question?.explanation
            ? await this.mapExplanation(question.explanation)
            : undefined;

          return {
            questionId,
            selectedOption: aq.selectedOption,
            correctAnswer: question?.correctAnswer || '',
            isCorrect: aq.isCorrect || false,
            marksAwarded: aq.marksAwarded,
            explanation,
          };
        }),
      );
    }

    return response;
  }

  /**
   * Complete the current session on a session-wise full mock.
   * Opens the next session, or submits the paper when this was the last session.
   */
  async completeSession(
    attemptId: string,
    userId: string,
  ): Promise<CompleteSessionResponseDto> {
    if (!Types.ObjectId.isValid(attemptId)) {
      throw new BadRequestException('Invalid attempt ID format');
    }

    const attempt = await this.attemptModel
      .findOne({
        _id: attemptId,
        user: new Types.ObjectId(userId),
      })
      .exec();

    if (!attempt) {
      throw new NotFoundException(
        `Attempt with ID "${attemptId}" not found or you don't have access to it`,
      );
    }

    if (!attempt.isSessionWise || !attempt.sessions?.length) {
      throw new BadRequestException(
        'This attempt is not session-wise. Use POST /:attemptId/submit instead.',
      );
    }

    if (attempt.status === 'PAUSED') {
      throw new BadRequestException(
        'Resume the attempt before completing a session.',
      );
    }

    if (attempt.status === 'SUBMITTED' || attempt.status === 'EXPIRED') {
      throw new BadRequestException(
        `Cannot complete a session on an attempt with status "${attempt.status}".`,
      );
    }

    const session = this.getCurrentSession(attempt);
    if (!session) {
      throw new BadRequestException('No active session found');
    }

    if (session.status === 'LOCKED') {
      throw new BadRequestException('This session is locked');
    }

    const timeElapsed = this.calculateTimeElapsed(attempt);
    const allowedTime = this.getAllowedTimeSeconds(attempt);
    const isExpired = timeElapsed > allowedTime;

    if (session.status === 'IN_PROGRESS' || session.status === 'PAUSED') {
      session.status = isExpired ? 'EXPIRED' : 'SUBMITTED';
      session.submittedAt = new Date();
      session.timeConsumed = Math.min(timeElapsed, allowedTime);
      this.persistTotalTimeConsumed(attempt, timeElapsed);
    }

    const isLast = attempt.currentSessionIndex >= attempt.sessions.length - 1;

    if (isLast) {
      await attempt.save();
      const results = await this.submitAttempt(attemptId, userId);
      const fresh = await this.attemptModel.findById(attemptId).exec();
      return {
        paperCompleted: true,
        sessions: (fresh?.sessions || attempt.sessions).map(s =>
          this.mapSessionDto(s),
        ),
        currentSessionIndex:
          fresh?.currentSessionIndex ?? attempt.currentSessionIndex,
        results,
      };
    }

    attempt.currentSessionIndex += 1;
    const next = attempt.sessions[attempt.currentSessionIndex];
    next.status = 'IN_PROGRESS';
    next.startedAt = new Date();
    next.timeConsumed = 0;
    attempt.status = 'IN_PROGRESS';
    attempt.startedAt = next.startedAt;
    await attempt.save();

    const nextSession = await this.resumeAttempt(attemptId, userId);

    return {
      paperCompleted: false,
      sessions: (attempt.sessions || []).map(s => this.mapSessionDto(s)),
      currentSessionIndex: attempt.currentSessionIndex,
      nextSession,
    };
  }

  private async loadLockedQuestionRows(
    attemptQuestions: AttemptQuestion[],
    hideAnswers: boolean,
  ): Promise<Array<{ aq: AttemptQuestion; question: any }>> {
    const ids = attemptQuestions.map(q => q.question);
    // Include soft-deleted rows: the attempt already locked these IDs into the paper.
    let query = this.questionModel
      .find({ _id: { $in: ids } })
      .setOptions({ includeDeleted: true });
    if (hideAnswers) {
      query = query.select('-correctAnswer -explanation');
    }
    const docs = await query.lean().exec();
    const questionMap = new Map(
      docs.map((q: { _id: { toString(): string } }) => [q._id.toString(), q]),
    );
    return attemptQuestions
      .map(aq => ({
        aq,
        question: questionMap.get(aq.question.toString()),
      }))
      .filter(row => Boolean(row.question));
  }

  private async mapAttemptQuestionsWithSession(
    questions: Array<{
      _id: { toString(): string };
      questionText?: {
        en?: { text?: string | null; image?: ImageLike };
        ml?: { text?: string | null; image?: ImageLike };
      };
      optionType?: string;
      options?: Array<{
        id: string;
        type: string;
        en?: string | null;
        ml?: string | null;
        image?: ImageLike;
      }>;
      subject?: { toString(): string };
      topic?: { toString(): string };
      difficultyLevel?: string;
    }>,
    attemptQuestions: AttemptQuestion[],
  ) {
    const mapped = await this.mapAttemptQuestions(questions);
    return mapped.map((questionDto, index) => {
      const sessionOrder = attemptQuestions[index]?.sessionOrder;
      if (sessionOrder == null) {
        return questionDto;
      }
      return { ...questionDto, sessionOrder };
    });
  }

  private collectStemImages(question: {
    questionText?: {
      en?: { image?: ImageLike };
      ml?: { image?: ImageLike };
    };
    options?: Array<{ image?: ImageLike }>;
  }): ImageLike[] {
    return [
      question.questionText?.en?.image,
      question.questionText?.ml?.image,
      ...(question.options || []).map(option => option.image),
    ];
  }

  private async mapAttemptQuestions(
    questions: Array<{
      _id: { toString(): string };
      questionText?: {
        en?: { text?: string | null; image?: ImageLike };
        ml?: { text?: string | null; image?: ImageLike };
      };
      optionType?: string;
      options?: Array<{
        id: string;
        type: string;
        en?: string | null;
        ml?: string | null;
        image?: ImageLike;
      }>;
      subject?: { toString(): string };
      topic?: { toString(): string };
      difficultyLevel?: string;
    }>,
  ) {
    const urls = await this.imageUrlResolver.resolveMany(
      questions.flatMap(question => this.collectStemImages(question)),
    );
    let cursor = 0;

    return questions.map(question => {
      const enUrl = urls[cursor++];
      const mlUrl = urls[cursor++];
      const options = (question.options || []).map(option => ({
        id: option.id,
        type: option.type,
        en: option.en,
        ml: option.ml,
        imageUrl: urls[cursor++],
      }));

      return {
        _id: question._id.toString(),
        questionText: {
          en: {
            text: question.questionText?.en?.text || null,
            imageUrl: enUrl,
          },
          ml: {
            text: question.questionText?.ml?.text || null,
            imageUrl: mlUrl,
          },
        },
        optionType: question.optionType,
        options,
        subject: question.subject?.toString(),
        topic: question.topic?.toString(),
        difficultyLevel: question.difficultyLevel,
      };
    });
  }

  private async mapExplanation(explanation: {
    en?: string | null;
    ml?: string | null;
    image?: ImageLike;
    images?: ImageLike[];
  }) {
    const extras = explanation.images || [];
    const [imageUrl, ...imageUrls] = await this.imageUrlResolver.resolveMany([
      explanation.image,
      ...extras,
    ]);

    return {
      en: explanation.en || null,
      ml: explanation.ml || null,
      imageUrl,
      imageUrls: imageUrls.filter((url): url is string => Boolean(url)),
    };
  }
}
