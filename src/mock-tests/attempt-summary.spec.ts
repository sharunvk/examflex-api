import { Types } from 'mongoose';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';
import {
  AttemptSummarySource,
  buildEnrichmentsForTests,
  buildUserAttemptEnrichment,
  calculateAttemptTimeElapsed,
  countAnswered,
  countCorrectIncorrect,
  isAttemptOverdue,
} from './attempt-summary';

const TEST_ID = '507f1f77bcf86cd799439011';
const ATTEMPT_A = '507f1f77bcf86cd799439018';
const ATTEMPT_B = '507f1f77bcf86cd799439019';

function attempt(
  overrides: Partial<AttemptSummarySource> &
    Pick<AttemptSummarySource, 'status'>,
): AttemptSummarySource {
  return {
    _id: new Types.ObjectId(ATTEMPT_A),
    mockTest: new Types.ObjectId(TEST_ID),
    startedAt: new Date('2024-01-01T10:00:00.000Z'),
    durationInMinutes: 10,
    score: 0,
    timeConsumed: 0,
    questions: [],
    ...overrides,
  };
}

describe('attempt-summary helpers', () => {
  describe('isAttemptOverdue', () => {
    const startedAt = new Date('2024-01-01T10:00:00.000Z');
    const at = (seconds: number) => startedAt.getTime() + seconds * 1000;

    it('flags an in-progress paper past its time', () => {
      const row = attempt({ status: 'IN_PROGRESS', startedAt });
      expect(isAttemptOverdue(row, at(600))).toBe(false);
      expect(isAttemptOverdue(row, at(601))).toBe(true);
    });

    it('never flags paused or closed attempts', () => {
      for (const status of ['PAUSED', 'SUBMITTED', 'EXPIRED']) {
        expect(
          isAttemptOverdue(
            attempt({ status, startedAt, timeConsumed: 9999 }),
            at(99_999),
          ),
        ).toBe(false);
      }
    });

    it('only flags the last section of a session-wise paper', () => {
      const sessions = [
        { status: 'IN_PROGRESS', durationInMinutes: 1, startedAt },
        { status: 'LOCKED', durationInMinutes: 1 },
      ];
      const first = attempt({
        status: 'IN_PROGRESS',
        startedAt,
        isSessionWise: true,
        currentSessionIndex: 0,
        sessions,
      });
      expect(isAttemptOverdue(first, at(3600))).toBe(false);

      const last = attempt({
        status: 'IN_PROGRESS',
        startedAt,
        isSessionWise: true,
        currentSessionIndex: 1,
        sessions: [
          { status: 'SUBMITTED', durationInMinutes: 1, timeConsumed: 60 },
          { status: 'IN_PROGRESS', durationInMinutes: 1, startedAt },
        ],
      });
      expect(isAttemptOverdue(last, at(60))).toBe(false);
      expect(isAttemptOverdue(last, at(61))).toBe(true);
    });
  });

  describe('countAnswered / countCorrectIncorrect', () => {
    it('counts selected options and correct/incorrect flags', () => {
      const questions = [
        { selectedOption: 'a', isCorrect: true },
        { selectedOption: 'b', isCorrect: false },
        { selectedOption: null, isCorrect: null },
        { selectedOption: undefined },
      ];
      expect(countAnswered(questions)).toBe(2);
      expect(countCorrectIncorrect(questions)).toEqual({
        correct: 1,
        incorrect: 1,
      });
    });
  });

  describe('calculateAttemptTimeElapsed', () => {
    it('adds live elapsed for IN_PROGRESS attempts', () => {
      const startedAt = new Date('2024-01-01T10:00:00.000Z');
      const now = startedAt.getTime() + 90_000;
      expect(
        calculateAttemptTimeElapsed(
          attempt({
            status: 'IN_PROGRESS',
            startedAt,
            timeConsumed: 10,
          }),
          now,
        ),
      ).toBe(100);
    });

    it('freezes elapsed for PAUSED attempts', () => {
      expect(
        calculateAttemptTimeElapsed(
          attempt({ status: 'PAUSED', timeConsumed: 42 }),
          Date.now(),
        ),
      ).toBe(42);
    });
  });

  describe('buildUserAttemptEnrichment', () => {
    it('returns NONE / START when there are no attempts', () => {
      const result = buildUserAttemptEnrichment([]);
      expect(result.action).toBe(UserAttemptAction.START);
      expect(result.resumeAttemptId).toBeUndefined();
      expect(result.attemptSummary).toMatchObject({
        status: 'NONE',
        attemptCount: 0,
      });
    });

    it('builds IN_PROGRESS progress fields with answered + remaining time', () => {
      const startedAt = new Date('2024-01-01T10:00:00.000Z');
      const now = startedAt.getTime() + 230_000;
      const result = buildUserAttemptEnrichment(
        [
          attempt({
            status: 'IN_PROGRESS',
            startedAt,
            timeConsumed: 0,
            durationInMinutes: 10,
            questions: [
              { selectedOption: 'a' },
              { selectedOption: 'b' },
              { selectedOption: null },
              {},
            ],
          }),
        ],
        now,
      );

      expect(result.action).toBe(UserAttemptAction.RESUME);
      expect(result.resumeAttemptId).toBe(ATTEMPT_A);
      expect(result.attemptSummary).toMatchObject({
        status: 'IN_PROGRESS',
        activeAttemptId: ATTEMPT_A,
        answeredCount: 2,
        timeRemainingSeconds: 370,
        timeElapsedSeconds: 230,
        attemptCount: 0,
      });
    });

    it('maps PAUSED to RESUME with PAUSED summary status', () => {
      const result = buildUserAttemptEnrichment([
        attempt({
          status: 'PAUSED',
          timeConsumed: 120,
          durationInMinutes: 10,
          questions: [{ selectedOption: 'a' }],
        }),
      ]);

      expect(result.action).toBe(UserAttemptAction.RESUME);
      expect(result.attemptSummary.status).toBe('PAUSED');
      expect(result.attemptSummary.answeredCount).toBe(1);
      expect(result.attemptSummary.timeRemainingSeconds).toBe(480);
    });

    it('aggregates best + last completed fields for RETAKE', () => {
      const newer = attempt({
        _id: new Types.ObjectId(ATTEMPT_A),
        status: 'SUBMITTED',
        score: 28,
        timeConsumed: 460,
        questions: [
          { selectedOption: 'a', isCorrect: true },
          { selectedOption: 'b', isCorrect: true },
          { selectedOption: 'c', isCorrect: false },
          { selectedOption: 'd', isCorrect: false },
        ],
      });
      const olderBest = attempt({
        _id: new Types.ObjectId(ATTEMPT_B),
        status: 'EXPIRED',
        score: 32,
        timeConsumed: 500,
        questions: [
          { selectedOption: 'a', isCorrect: true },
          { selectedOption: 'b', isCorrect: true },
          { selectedOption: 'c', isCorrect: true },
          { selectedOption: 'd', isCorrect: false },
        ],
      });

      const result = buildUserAttemptEnrichment([newer, olderBest]);

      expect(result.action).toBe(UserAttemptAction.RETAKE);
      expect(result.attemptSummary).toMatchObject({
        status: 'COMPLETED',
        attemptCount: 2,
        bestScore: 32,
        bestCorrectAnswers: 3,
        lastAttemptId: ATTEMPT_A,
        lastScore: 28,
        lastCorrectAnswers: 2,
        lastTimeTakenSeconds: 460,
        lastIncorrectAnswers: 2,
      });
    });

    it('prefers active attempt over completed history', () => {
      const result = buildUserAttemptEnrichment([
        attempt({
          status: 'IN_PROGRESS',
          questions: [{ selectedOption: 'a' }],
        }),
        attempt({
          _id: new Types.ObjectId(ATTEMPT_B),
          status: 'SUBMITTED',
          score: 10,
          questions: [
            { selectedOption: 'a', isCorrect: true },
            { selectedOption: 'b', isCorrect: false },
          ],
        }),
      ]);

      expect(result.action).toBe(UserAttemptAction.RESUME);
      expect(result.attemptSummary.status).toBe('IN_PROGRESS');
      expect(result.attemptSummary.attemptCount).toBe(1);
      expect(result.attemptSummary.bestScore).toBe(10);
      expect(result.attemptSummary.lastIncorrectAnswers).toBe(1);
    });
  });

  describe('buildEnrichmentsForTests', () => {
    it('returns NONE for tests with no attempts and groups by mockTest', () => {
      const otherTest = '507f1f77bcf86cd799439012';
      const map = buildEnrichmentsForTests(
        [TEST_ID, otherTest],
        [
          attempt({
            status: 'SUBMITTED',
            score: 4,
            questions: [{ selectedOption: 'a', isCorrect: true }],
          }),
        ],
      );

      expect(map.get(TEST_ID)?.action).toBe(UserAttemptAction.RETAKE);
      expect(map.get(otherTest)?.attemptSummary.status).toBe('NONE');
    });
  });
});
