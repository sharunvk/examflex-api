import { Types } from 'mongoose';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';
import {
  AttemptSummaryDto,
  AttemptSummaryStatus,
} from './dto/attempt-summary.dto';

export type AttemptSummaryQuestion = {
  selectedOption?: string | null;
  isCorrect?: boolean | null;
};

export type AttemptSummarySession = {
  status?: string;
  timeConsumed?: number;
  durationInMinutes: number;
  startedAt?: Date | string;
};

/** Lean attempt fields needed to build catalog card summaries. */
export type AttemptSummarySource = {
  _id: Types.ObjectId | string;
  mockTest: Types.ObjectId | string;
  status: string;
  score?: number;
  timeConsumed?: number;
  startedAt: Date | string;
  submittedAt?: Date | string;
  durationInMinutes: number;
  isSessionWise?: boolean;
  currentSessionIndex?: number;
  sessions?: AttemptSummarySession[];
  questions?: AttemptSummaryQuestion[];
  createdAt?: Date | string;
};

export type UserAttemptEnrichment = {
  action: UserAttemptAction;
  resumeAttemptId?: string;
  attemptSummary: AttemptSummaryDto;
};

function asDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value : new Date(value);
}

function getCurrentSession(
  attempt: AttemptSummarySource,
): AttemptSummarySession | null {
  if (!attempt.isSessionWise || !attempt.sessions?.length) {
    return null;
  }
  return attempt.sessions[attempt.currentSessionIndex ?? 0] || null;
}

function getAllowedTimeSeconds(attempt: AttemptSummarySource): number {
  const session = getCurrentSession(attempt);
  if (session) {
    return session.durationInMinutes * 60;
  }
  return attempt.durationInMinutes * 60;
}

/** Mirrors attempt-service timer math for lean list docs (no Document needed). */
export function calculateAttemptTimeElapsed(
  attempt: AttemptSummarySource,
  nowMs = Date.now(),
): number {
  const session = getCurrentSession(attempt);
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
    const started = asDate(session.startedAt) || asDate(attempt.startedAt)!;
    const currentSessionTime = Math.floor((nowMs - started.getTime()) / 1000);
    return (session.timeConsumed || 0) + currentSessionTime;
  }

  if (
    attempt.status === 'PAUSED' ||
    attempt.status === 'SUBMITTED' ||
    attempt.status === 'EXPIRED'
  ) {
    return attempt.timeConsumed || 0;
  }

  const started = asDate(attempt.startedAt)!;
  const currentSessionTime = Math.floor((nowMs - started.getTime()) / 1000);
  return (attempt.timeConsumed || 0) + currentSessionTime;
}

export function countAnswered(
  questions: AttemptSummaryQuestion[] = [],
): number {
  return questions.reduce(
    (count, question) => (question.selectedOption ? count + 1 : count),
    0,
  );
}

export function countCorrectIncorrect(
  questions: AttemptSummaryQuestion[] = [],
): {
  correct: number;
  incorrect: number;
} {
  let correct = 0;
  let incorrect = 0;
  for (const question of questions) {
    if (!question.selectedOption) continue;
    if (question.isCorrect === true) correct += 1;
    else if (question.isCorrect === false) incorrect += 1;
  }
  return { correct, incorrect };
}

function idString(value: Types.ObjectId | string): string {
  return typeof value === 'string' ? value : value.toString();
}

function noneSummary(): AttemptSummaryDto {
  return new AttemptSummaryDto({ status: 'NONE', attemptCount: 0 });
}

function aggregateCompleted(completed: AttemptSummarySource[]): {
  attemptCount: number;
  bestScore?: number;
  bestCorrectAnswers?: number;
  lastAttemptId?: string;
  lastScore?: number;
  lastCorrectAnswers?: number;
  lastTimeTakenSeconds?: number;
  lastIncorrectAnswers?: number;
} {
  if (completed.length === 0) {
    return { attemptCount: 0 };
  }

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCorrectAnswers = 0;
  for (const attempt of completed) {
    const score = attempt.score ?? 0;
    const { correct } = countCorrectIncorrect(attempt.questions);
    if (score > bestScore) {
      bestScore = score;
      bestCorrectAnswers = correct;
    } else if (score === bestScore) {
      bestCorrectAnswers = Math.max(bestCorrectAnswers, correct);
    }
  }

  const last = completed[0];
  const lastCounts = countCorrectIncorrect(last.questions);

  return {
    attemptCount: completed.length,
    bestScore: Number.isFinite(bestScore) ? bestScore : undefined,
    bestCorrectAnswers,
    lastAttemptId: idString(last._id),
    lastScore: last.score ?? 0,
    lastCorrectAnswers: lastCounts.correct,
    lastTimeTakenSeconds: last.timeConsumed ?? 0,
    lastIncorrectAnswers: lastCounts.incorrect,
  };
}

/** Build CTA + card summary for one paper from newest-first attempts. */
export function buildUserAttemptEnrichment(
  attemptsNewestFirst: AttemptSummarySource[],
  nowMs = Date.now(),
): UserAttemptEnrichment {
  if (attemptsNewestFirst.length === 0) {
    return {
      action: UserAttemptAction.START,
      attemptSummary: noneSummary(),
    };
  }

  const active = attemptsNewestFirst.find(
    attempt => attempt.status === 'PAUSED' || attempt.status === 'IN_PROGRESS',
  );
  const completed = attemptsNewestFirst.filter(
    attempt => attempt.status === 'SUBMITTED' || attempt.status === 'EXPIRED',
  );
  const completedAgg = aggregateCompleted(completed);

  if (active) {
    const elapsed = calculateAttemptTimeElapsed(active, nowMs);
    const allowed = getAllowedTimeSeconds(active);
    const timeRemainingSeconds = Math.max(0, allowed - elapsed);
    const status: AttemptSummaryStatus =
      active.status === 'PAUSED' ? 'PAUSED' : 'IN_PROGRESS';

    return {
      action: UserAttemptAction.RESUME,
      resumeAttemptId: idString(active._id),
      attemptSummary: new AttemptSummaryDto({
        status,
        activeAttemptId: idString(active._id),
        answeredCount: countAnswered(active.questions),
        timeRemainingSeconds,
        timeElapsedSeconds: Math.min(elapsed, allowed),
        attemptCount: completedAgg.attemptCount,
        bestScore: completedAgg.bestScore,
        bestCorrectAnswers: completedAgg.bestCorrectAnswers,
        lastAttemptId: completedAgg.lastAttemptId,
        lastScore: completedAgg.lastScore,
        lastCorrectAnswers: completedAgg.lastCorrectAnswers,
        lastTimeTakenSeconds: completedAgg.lastTimeTakenSeconds,
        lastIncorrectAnswers: completedAgg.lastIncorrectAnswers,
      }),
    };
  }

  if (completed.length > 0) {
    return {
      action: UserAttemptAction.RETAKE,
      attemptSummary: new AttemptSummaryDto({
        status: 'COMPLETED',
        ...completedAgg,
      }),
    };
  }

  return {
    action: UserAttemptAction.START,
    attemptSummary: noneSummary(),
  };
}

/** Group lean attempts by mockTest id (preserves newest-first order). */
export function groupAttemptsByMockTest(
  attempts: AttemptSummarySource[],
): Map<string, AttemptSummarySource[]> {
  const map = new Map<string, AttemptSummarySource[]>();
  for (const attempt of attempts) {
    const testId = idString(attempt.mockTest);
    const list = map.get(testId);
    if (list) {
      list.push(attempt);
    } else {
      map.set(testId, [attempt]);
    }
  }
  return map;
}

export function buildEnrichmentsForTests(
  mockTestIds: string[],
  attemptsNewestFirst: AttemptSummarySource[],
  nowMs = Date.now(),
): Map<string, UserAttemptEnrichment> {
  const byTest = groupAttemptsByMockTest(attemptsNewestFirst);
  const map = new Map<string, UserAttemptEnrichment>();
  for (const testId of mockTestIds) {
    map.set(
      testId,
      buildUserAttemptEnrichment(byTest.get(testId) || [], nowMs),
    );
  }
  return map;
}
