import { AnalysisOverviewResponseDto } from '../analysis/dto/analysis-overview-response.dto';
import { MistakeBookTeaserDto } from '../mistake-book/dto/mistake-book-teaser.dto';
import { buildTodayPage } from './today-page.builder';

const EXAM_ID = '507f1f77bcf86cd799439011';

function emptyAnalysis(
  overrides: Partial<AnalysisOverviewResponseDto> = {},
): AnalysisOverviewResponseDto {
  return {
    exam: { id: EXAM_ID, name: 'NEET', totalMarks: 720 },
    fullMocks: {
      completedCount: 0,
      targetCount: 5,
      needsMoreAttempts: true,
      latest: null,
      recent: [],
    },
    pathways: { averagePercent: null, attemptCountUsed: 0, offerings: [] },
    subjects: {
      source: 'TOPIC_WISE',
      attemptCount: 0,
      needsMoreAttempts: true,
      items: [],
    },
    engagement: {
      hasFullMocks: false,
      hasChapterWise: false,
      fullMockTarget: 5,
      fullMocksRemaining: 5,
    },
    ...overrides,
  };
}

describe('buildTodayPage', () => {
  it('builds empty mode for new users', () => {
    const page = buildTodayPage({
      examId: EXAM_ID,
      analysis: emptyAnalysis(),
      mistakes: new MistakeBookTeaserDto({ totalMistakes: 0, startWith: null }),
      nextMock: {
        id: 'm1',
        title: 'NEET full-syllabus mock',
        totalQuestions: 180,
        durationInMinutes: 180,
        examId: EXAM_ID,
      },
    });

    expect(page.mode).toBe('empty');
    expect(page.overview.eyebrow).toMatch(/WELCOME/i);
    expect(page.nextStep.showPath).toBe(true);
    expect(page.nextStep.title).toBe('Your first step is a quick revision.');
    expect(page.nextStep.body).toBe("Let's flex some equations.");
    expect(page.nextStep.ctaLabel).toMatch(/Open Equation Book/i);
    expect(page.nextStep.ctaHref).toBe('/equation-book');
    expect(page.nextMock.ctaHref).toBe(`/mocks/exam/${EXAM_ID}/full-mocks`);
    expect(page.sessionPlan.steps.map(s => s.state)).toEqual([
      'active',
      'active',
      'active',
    ]);
    expect(page.latestMock.score).toBeNull();
    expect(page.latestMock.placeholderMessage).toMatch(/lands here/i);
    expect(page.latestMock.attempts).toHaveLength(3);
    expect(page.subjectInsights.items.map(i => i.scoreLabel)).toEqual([
      '— / 180',
      '— / 180',
      '— / 360',
    ]);
    expect(page.perspective.locked).toBe(true);
    expect(page.nextMock.meta).toContain('180 questions');
    expect(page.equationBook.statusPill).toMatch(/Flip a card/i);
    expect(page.mistakeBook.title).toBe('Mistake Book');
    expect(page.mistakeBook.statusPill).toMatch(/Fills in after/i);
    expect(page.subjectInsights.items[0]?.scoreLabel).toBe('— / 180');
  });

  it('shows real Mistake Book stats before a full mock is completed', () => {
    const page = buildTodayPage({
      examId: EXAM_ID,
      analysis: emptyAnalysis({
        engagement: {
          hasFullMocks: false,
          hasChapterWise: true,
          fullMockTarget: 5,
          fullMocksRemaining: 5,
        },
      }),
      mistakes: new MistakeBookTeaserDto({
        totalMistakes: 24,
        startWith: { mockTestId: 'mt-ch', title: 'Kinematics - 1' },
      }),
      nextMock: null,
    });

    expect(page.mode).toBe('empty');
    expect(page.mistakeBook.body).toBe(
      '24 saved questions waiting for a calm look.',
    );
    expect(page.mistakeBook.statusPill).toBe('Start with 5 today');
    expect(page.mistakeBook.ctaHref).toBe('/mistake-book/mt-ch');
  });

  it('builds active mode with mistake pickup and subject percents', () => {
    const analysis = emptyAnalysis({
      fullMocks: {
        completedCount: 2,
        targetCount: 5,
        needsMoreAttempts: true,
        latest: {
          attemptId: 'a2',
          title: 'Mock 12',
          score: 548,
          maxScore: 720,
          percent: 76,
          submittedAt: '2026-11-01T00:00:00.000Z',
          deltaFromPrevious: 18,
          correctCount: 144,
          incorrectCount: 28,
          skippedCount: 8,
        },
        recent: [
          {
            attemptId: 'a1',
            label: 'Mock 11',
            title: 'Mock 11',
            score: 530,
            maxScore: 720,
            percent: 73,
            submittedAt: '2026-10-01T00:00:00.000Z',
          },
          {
            attemptId: 'a2',
            label: 'Mock 12',
            title: 'Mock 12',
            score: 548,
            maxScore: 720,
            percent: 76,
            submittedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
      },
      subjects: {
        source: 'TOPIC_WISE',
        attemptCount: 4,
        needsMoreAttempts: false,
        items: [
          {
            subjectId: 's1',
            subjectName: 'Physics',
            attemptCount: 2,
            averagePercent: 62.4,
            strengthLabel: 'Weak',
            topics: [
              {
                topicId: 't1',
                topicName: 'Force & friction',
                attemptCount: 1,
                averagePercent: 40,
                isWeak: true,
                isStrong: false,
              },
            ],
            tip: 'Force & friction need another look.',
          },
        ],
      },
      engagement: {
        hasFullMocks: true,
        hasChapterWise: true,
        fullMockTarget: 5,
        fullMocksRemaining: 3,
      },
    });

    const page = buildTodayPage({
      examId: EXAM_ID,
      analysis,
      mistakes: new MistakeBookTeaserDto({
        totalMistakes: 19,
        startWith: { mockTestId: 'mt1', title: 'Mock 12' },
      }),
      nextMock: null,
    });

    expect(page.mode).toBe('active');
    expect(page.nextStep.showPath).toBe(false);
    expect(page.nextStep.ctaHref).toBe('/mistake-book/mt1');
    expect(page.nextStep.body).toContain('19 questions');
    expect(page.latestMock.score).toBe(548);
    expect(page.latestMock.deltaLabel).toBe('+18 from previous');
    expect(page.latestMock.breakdown).toContain('144 correct');
    expect(page.subjectInsights.items[0].scoreLabel).toBe('62%');
    expect(page.subjectInsights.items[0].tip).toMatch(/friction/i);
    expect(page.perspective.locked).toBe(false);
    expect(page.perspective.ctaLabel).toMatch(/Analysis/i);
    expect(page.sessionPlan.steps.map(s => s.state)).toEqual([
      'active',
      'active',
      'active',
    ]);
  });

  it('keeps all session steps active when there are no remaining mistakes', () => {
    const analysis = emptyAnalysis({
      fullMocks: {
        completedCount: 1,
        targetCount: 5,
        needsMoreAttempts: true,
        latest: {
          attemptId: 'a1',
          title: 'Mock 1',
          score: 400,
          maxScore: 720,
          percent: 55,
          submittedAt: '2026-11-01T00:00:00.000Z',
          deltaFromPrevious: null,
        },
        recent: [
          {
            attemptId: 'a1',
            label: 'Mock 1',
            title: 'Mock 1',
            score: 400,
            maxScore: 720,
            percent: 55,
            submittedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
      },
      engagement: {
        hasFullMocks: true,
        hasChapterWise: false,
        fullMockTarget: 5,
        fullMocksRemaining: 4,
      },
    });

    const page = buildTodayPage({
      examId: EXAM_ID,
      analysis,
      mistakes: new MistakeBookTeaserDto({ totalMistakes: 0, startWith: null }),
      nextMock: null,
    });

    expect(page.nextStep.ctaHref).toBe(`/mocks/exam/${EXAM_ID}/full-mocks`);
    expect(page.sessionPlan.steps.map(s => s.state)).toEqual([
      'active',
      'active',
      'active',
    ]);
  });
});
