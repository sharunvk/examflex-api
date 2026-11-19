import { AnalysisOverviewResponseDto } from '../analysis/dto/analysis-overview-response.dto';
import { MistakeBookTeaserDto } from '../mistake-book/dto/mistake-book-teaser.dto';
import {
  TodayLatestMockDto,
  TodayMode,
  TodayNextMockDto,
  TodayNextStepDto,
  TodayPageResponseDto,
  TodayPerspectiveDto,
  TodaySessionPlanDto,
  TodaySessionStepDto,
  TodaySubjectInsightDto,
  TodaySubjectInsightsSectionDto,
} from './dto/today-response.dto';

export type NextMockTeaser = {
  id: string;
  title: string;
  totalQuestions: number;
  durationInMinutes: number;
  examId: string;
} | null;

const PACE_BADGE = 'examflex  /  Your pace, your plan';
const DEFAULT_SUBJECT_ROWS = [
  { subject: 'Physics', scoreLabel: '— / 180' },
  { subject: 'Chemistry', scoreLabel: '— / 180' },
  { subject: 'Biology', scoreLabel: '— / 360' },
] as const;

export function buildTodayPage(input: {
  examId: string;
  analysis: AnalysisOverviewResponseDto;
  mistakes: MistakeBookTeaserDto;
  nextMock: NextMockTeaser;
}): TodayPageResponseDto {
  const { examId, analysis, mistakes, nextMock } = input;
  const hasFullMocks = analysis.fullMocks.completedCount >= 1;
  const mode: TodayMode = hasFullMocks ? 'active' : 'empty';
  const maxScore =
    analysis.fullMocks.latest?.maxScore ?? analysis.exam.totalMarks ?? 720;

  return {
    mode,
    examId,
    overview: buildOverview(mode),
    nextStep: buildNextStep(mode, mistakes, examId),
    sessionPlan: buildSessionPlan(mode, hasFullMocks, mistakes.totalMistakes),
    latestMock: buildLatestMock(mode, analysis, maxScore),
    subjectInsights: buildSubjectInsights(mode, analysis),
    equationBook: {
      eyebrow: 'YOUR POCKET REVISION',
      title: 'Equation Book',
      body: "Recall it. Don't just recognise it.",
      ctaLabel: 'Open Equation Book  →',
      ctaHref: '/equation-book',
      statusPill: 'Flip a card. Say it out loud. Then check.',
    },
    mistakeBook: buildMistakeBook(mistakes),
    nextMock: buildNextMock(nextMock, examId, analysis.exam.name),
    perspective: buildPerspective(mode),
    footerRight:
      mode === 'empty'
        ? 'No admission prediction'
        : 'Based on your full mocks · No admission prediction',
  };
}

function buildOverview(mode: TodayMode) {
  if (mode === 'empty') {
    return {
      eyebrow: 'WELCOME TO YOUR STUDY SPACE',
      headline: 'One good step at a time.',
      subhead: 'Not more things to study. A clearer idea of what to do next.',
      paceBadge: PACE_BADGE,
    };
  }
  return {
    eyebrow: 'YOUR STUDY SPACE',
    headline: 'One good step at a time.',
    subhead: 'Not more things to study. A clearer idea of what to do next.',
    paceBadge: PACE_BADGE,
  };
}

function buildNextStep(
  mode: TodayMode,
  mistakes: MistakeBookTeaserDto,
  examId: string,
): TodayNextStepDto {
  if (mode === 'empty') {
    return {
      eyebrow: 'START HERE',
      title: 'Your first step is one mock.',
      body: 'Take a full-syllabus mock. Misses land in your Mistake Book for calm review, and you get a score you can build on.',
      ctaLabel: 'Take your first mock  →',
      ctaHref: `/mocks/exam/${examId}/full-mocks`,
      aside: 'Small start. Real progress.',
      showPath: true,
    };
  }

  if (mistakes.totalMistakes > 0 && mistakes.startWith) {
    const start = Math.min(5, mistakes.totalMistakes);
    return {
      eyebrow: 'PICK UP WHERE YOU LEFT OFF',
      title: 'Your mistakes have a next chapter.',
      body: `${mistakes.totalMistakes} question${
        mistakes.totalMistakes === 1 ? '' : 's'
      } left to review from ${mistakes.startWith.title}. Start with ${start} today.`,
      ctaLabel: 'Open Mistake Book  →',
      ctaHref: `/mistake-book/${mistakes.startWith.mockTestId}`,
      aside: 'Small session. Real progress.',
      showPath: false,
    };
  }

  return {
    eyebrow: 'KEEP THE STREAK GOING',
    title: 'Your next step is another mock.',
    body: 'A fresh full-syllabus attempt updates your score, Mistake Book, and Analysis pathways.',
    ctaLabel: 'View mocks  →',
    ctaHref: `/mocks/exam/${examId}/full-mocks`,
    aside: 'Small start. Real progress.',
    showPath: false,
  };
}

function buildSessionPlan(
  mode: TodayMode,
  hasFullMocks: boolean,
  totalMistakes: number,
): TodaySessionPlanDto {
  if (mode === 'empty' || !hasFullMocks) {
    return {
      eyebrow: 'TODAY, KEEP IT LIGHT',
      title: 'Your 20-minute reset',
      steps: [
        step('01', 'Take your first mock', 'active'),
        step('02', 'Understand your saved mistakes', 'locked'),
        step('03', 'Recall your first equations', 'locked'),
      ],
    };
  }

  const steps: TodaySessionStepDto[] = [
    step('01', 'Take your first mock', 'done'),
  ];

  if (totalMistakes > 0) {
    const n = Math.min(5, totalMistakes);
    steps.push(
      step(
        '02',
        `Understand ${n} saved mistake${n === 1 ? '' : 's'}`,
        'active',
      ),
    );
    steps.push(step('03', 'Recall equations from your misses', 'locked'));
  } else {
    steps.push(step('02', 'Understand your saved mistakes', 'done'));
    steps.push(step('03', 'Recall equations from your misses', 'active'));
  }

  return {
    eyebrow: 'TODAY, KEEP IT LIGHT',
    title: 'Your 20-minute reset',
    steps,
  };
}

function step(
  index: string,
  label: string,
  state: TodaySessionStepDto['state'],
): TodaySessionStepDto {
  return { index, label, state };
}

function buildLatestMock(
  mode: TodayMode,
  analysis: AnalysisOverviewResponseDto,
  maxScore: number,
): TodayLatestMockDto {
  if (mode === 'empty' || !analysis.fullMocks.latest) {
    return {
      title: 'A score is a starting point.',
      meta: 'Your first mock · Full syllabus',
      score: null,
      maxScore,
      deltaLabel: null,
      breakdown: null,
      placeholderMessage: 'Your first score lands here.',
      attempts: [
        { id: 'placeholder-1', label: 'Mock 1', score: null },
        { id: 'placeholder-2', label: 'Mock 2', score: null },
        { id: 'placeholder-3', label: 'Mock 3', score: null },
      ],
    };
  }

  const latest = analysis.fullMocks.latest;
  const recent = analysis.fullMocks.recent.slice(-3);
  const delta =
    latest.deltaFromPrevious == null
      ? null
      : latest.deltaFromPrevious >= 0
        ? `+${latest.deltaFromPrevious} from previous`
        : `${latest.deltaFromPrevious} from previous`;

  const breakdown =
    latest.correctCount !== undefined &&
    latest.incorrectCount !== undefined &&
    latest.skippedCount !== undefined
      ? `${latest.correctCount} correct  ·  ${latest.incorrectCount} incorrect  ·  ${latest.skippedCount} skipped`
      : null;

  return {
    title: 'A score is a starting point.',
    meta: `${latest.title}  ·  Full syllabus`,
    score: latest.score,
    maxScore: latest.maxScore,
    deltaLabel: delta,
    breakdown,
    placeholderMessage: null,
    attempts: recent.map(item => ({
      id: item.attemptId,
      label: item.label,
      score: item.score,
    })),
  };
}

function buildSubjectInsights(
  mode: TodayMode,
  analysis: AnalysisOverviewResponseDto,
): TodaySubjectInsightsSectionDto {
  if (mode === 'empty' || analysis.subjects.items.length === 0) {
    return {
      title: 'Where your next session can help',
      subhead:
        'After your first mock, we point to the chapter worth another look.',
      items: DEFAULT_SUBJECT_ROWS.map(row => ({
        subject: row.subject,
        scoreLabel: row.scoreLabel,
        tip: '',
        averagePercent: null,
      })),
    };
  }

  const items: TodaySubjectInsightDto[] = analysis.subjects.items.map(item => {
    const tip =
      item.tip?.trim() ||
      weakestTopicTip(item.topics) ||
      `${item.strengthLabel} on chapter practice.`;
    return {
      subject: item.subjectName,
      scoreLabel: `${Math.round(item.averagePercent)}%`,
      tip,
      averagePercent: item.averagePercent,
    };
  });

  return {
    title: 'Where your next session can help',
    subhead: null,
    items,
  };
}

function weakestTopicTip(
  topics: AnalysisOverviewResponseDto['subjects']['items'][number]['topics'],
): string | null {
  const weak = topics
    .filter(t => t.isWeak)
    .sort((a, b) => a.averagePercent - b.averagePercent);
  if (weak.length === 0) return null;
  return `${weak[0].topicName} needs another look.`;
}

function buildMistakeBook(mistakes: MistakeBookTeaserDto) {
  // Mistake Book copy follows real saved misses — not full-mock "empty" mode.
  // Chapter-wise / sprint attempts can fill the book before a full mock.
  if (mistakes.totalMistakes === 0) {
    return {
      eyebrow: 'TURN MISSES INTO MOMENTUM',
      title: 'Mistake Book',
      body: 'Wrong answers become short reviews — not a pile you ignore.',
      ctaLabel: 'Open Mistake Book  →',
      ctaHref: '/mistake-book',
      statusPill: 'Fills in after your first mock',
    };
  }

  const start = Math.min(5, mistakes.totalMistakes);
  return {
    eyebrow: 'TURN MISSES INTO MOMENTUM',
    title: 'Mistake Book',
    body: `${mistakes.totalMistakes} saved ${
      mistakes.totalMistakes === 1 ? 'question' : 'questions'
    } waiting for a calm look.`,
    ctaLabel: 'Open Mistake Book  →',
    ctaHref: mistakes.startWith
      ? `/mistake-book/${mistakes.startWith.mockTestId}`
      : '/mistake-book',
    statusPill: `Start with ${start} today`,
  };
}

function buildNextMock(
  teaser: NextMockTeaser,
  examId: string,
  examName: string,
): TodayNextMockDto {
  if (teaser) {
    return {
      eyebrow: 'READY FOR A FRESH ATTEMPT?',
      title: teaser.title || `${examName} full-syllabus mock`,
      meta: `${teaser.totalQuestions} questions  ·  ${teaser.durationInMinutes} minutes`,
      ctaLabel: 'View mocks  →',
      ctaHref: `/mocks/exam/${examId}/full-mocks`,
    };
  }

  return {
    eyebrow: 'READY FOR A FRESH ATTEMPT?',
    title: `${examName} full-syllabus mock`,
    meta: 'Full syllabus mock',
    ctaLabel: 'View mocks  →',
    ctaHref: `/mocks/exam/${examId}/full-mocks`,
  };
}

function buildPerspective(mode: TodayMode): TodayPerspectiveDto {
  if (mode === 'empty') {
    return {
      eyebrow: 'A LITTLE PERSPECTIVE',
      title: 'See where you could go.',
      body: 'Pathways appear after your first score. Past cutoffs, not promises.',
      ctaLabel: 'Unlocks with your first score',
      ctaHref: '/analysis',
      locked: true,
    };
  }

  return {
    eyebrow: 'A LITTLE PERSPECTIVE',
    title: 'See where you could go.',
    body: 'Open Analysis for full-mock form, course pathways, and chapter insights.',
    ctaLabel: 'Open Analysis  →',
    ctaHref: '/analysis',
    locked: false,
  };
}
