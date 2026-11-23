import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Exam } from '../exams/schemas/exam.schema';
import { MockTestAttempt } from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import { MockTest } from '../mock-tests/schemas/mock-test.schema';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AnalysisService } from './analysis.service';

const USER_ID = '64f123456789abcdef123450';
const EXAM_ID = '64f123456789abcdef123456';
const MBBS = '64f123456789abcdef1234aa';
const BDS = '64f123456789abcdef1234bb';

const oid = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, '0'));

function chain(result: unknown) {
  const q: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(result),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    select: jest.fn(),
    lean: jest.fn(),
  };
  for (const key of ['populate', 'sort', 'skip', 'limit', 'select', 'lean']) {
    q[key].mockReturnValue(q);
  }
  return q;
}

type AttemptOpts = {
  score: number;
  mock?: Types.ObjectId | null;
  title?: string;
  /** number of questions and marks each (defaults to NEET: 180 x 4) */
  questions?: number;
  marks?: number;
  /** explicit per-question marks (mixed-marks paper) */
  perQuestion?: number[];
  day?: number;
};

function attempt(opts: AttemptOpts) {
  const count = opts.questions ?? 180;
  const marks = opts.marks ?? 4;
  const questions = (opts.perQuestion ?? Array(count).fill(marks)).map(m => ({
    selectedOption: 'A',
    isCorrect: true,
    marksPerQuestion: m,
  }));
  return {
    _id: new Types.ObjectId(),
    ...(opts.mock === null
      ? {}
      : { mockTest: opts.mock ?? new Types.ObjectId() }),
    testTitle: opts.title,
    score: opts.score,
    totalQuestions: questions.length,
    marksPerQuestion: marks,
    submittedAt: new Date(`2026-01-${String(opts.day ?? 2).padStart(2, '0')}`),
    questions,
  };
}

function offering(
  id: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return { id, title, ...extra };
}

describe('AnalysisService', () => {
  let service: AnalysisService;
  const attemptModel: Record<string, jest.Mock> = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const examModel: Record<string, jest.Mock> = { findById: jest.fn() };
  const mockTestModel: Record<string, jest.Mock> = { find: jest.fn() };
  const recommendationsService = { listActiveCoursesForExam: jest.fn() };
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        {
          provide: getModelToken(MockTestAttempt.name),
          useValue: attemptModel,
        },
        { provide: getModelToken(Exam.name), useValue: examModel },
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        { provide: RecommendationsService, useValue: recommendationsService },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();
    service = module.get(AnalysisService);
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    cache.del.mockResolvedValue(undefined);
  });

  /**
   * Run getOverview with fixtures. `rows` are newest-first (as the DB returns).
   */
  async function run(input: {
    rows: ReturnType<typeof attempt>[];
    mocks?: Array<{
      _id: Types.ObjectId;
      courseCutoffs?: Array<{ offering: Types.ObjectId; cutoffMarks: number }>;
    }>;
    offerings?: ReturnType<typeof offering>[];
    chapterRows?: unknown[];
    /** omit => 720; pass null for an exam without a total-marks value */
    examTotalMarks?: number | null;
    total?: number;
  }) {
    examModel.findById.mockReturnValue(
      chain({
        _id: EXAM_ID,
        name: 'NEET UG',
        ...(('examTotalMarks' in input ? input.examTotalMarks : 720) === null
          ? {}
          : {
              totalMarks:
                'examTotalMarks' in input ? input.examTotalMarks : 720,
            }),
      }),
    );
    const fullMockChain = chain(input.rows);
    attemptModel.find
      .mockReturnValueOnce(fullMockChain)
      .mockReturnValueOnce(chain(input.chapterRows ?? []));
    attemptModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(input.total ?? input.rows.length),
    });
    mockTestModel.find.mockReturnValue(chain(input.mocks ?? []));
    recommendationsService.listActiveCoursesForExam.mockResolvedValue(
      input.offerings ?? [offering(MBBS, 'MBBS')],
    );
    const result = await service.getOverview(USER_ID, EXAM_ID);
    return { result, fullMockChain };
  }

  const cutoffsFor = (
    mock: Types.ObjectId,
    ...entries: Array<[string, number]>
  ) => ({
    _id: mock,
    courseCutoffs: entries.map(([id, cutoffMarks]) => ({
      offering: new Types.ObjectId(id),
      cutoffMarks,
    })),
  });

  describe('guards', () => {
    it('rejects invalid examId', async () => {
      await expect(service.getOverview(USER_ID, 'bad')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects invalid userId', async () => {
      await expect(service.getOverview('nope', EXAM_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws when exam missing', async () => {
      examModel.findById.mockReturnValue(chain(null));
      await expect(
        service.getOverview(USER_ID, EXAM_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cache', () => {
    it('returns cached overview when present and skips the database', async () => {
      const cached = { exam: { id: EXAM_ID, name: 'NEET' } };
      cache.get.mockResolvedValue(cached);
      const result = await service.getOverview(USER_ID, EXAM_ID);
      expect(result).toBe(cached);
      expect(examModel.findById).not.toHaveBeenCalled();
      expect(cache.get).toHaveBeenCalledWith(
        `analysis:overview:v2:${USER_ID}:${EXAM_ID}`,
      );
    });

    it('stores new results under the v2 key and tracks the exam', async () => {
      await run({ rows: [] });
      expect(cache.set).toHaveBeenCalledWith(
        `analysis:overview:v2:${USER_ID}:${EXAM_ID}`,
        expect.any(Object),
        expect.any(Number),
      );
      expect(cache.set).toHaveBeenCalledWith(
        `analysis:exams:${USER_ID}`,
        [EXAM_ID],
        expect.any(Number),
      );
    });

    it('does not re-add an exam that is already tracked', async () => {
      cache.get.mockImplementation((key: string) =>
        key === `analysis:exams:${USER_ID}`
          ? Promise.resolve([EXAM_ID])
          : Promise.resolve(undefined),
      );
      await run({ rows: [] });
      expect(cache.set).not.toHaveBeenCalledWith(
        `analysis:exams:${USER_ID}`,
        expect.anything(),
        expect.anything(),
      );
    });

    it('invalidates tracked exam keys (v2)', async () => {
      cache.get.mockResolvedValue([EXAM_ID]);
      await service.invalidateUserAnalysis(USER_ID);
      expect(cache.del).toHaveBeenCalledWith(
        `analysis:overview:v2:${USER_ID}:${EXAM_ID}`,
      );
      expect(cache.del).toHaveBeenCalledWith(`analysis:exams:${USER_ID}`);
    });

    it('invalidate is a no-op when nothing is tracked', async () => {
      cache.get.mockResolvedValue(undefined);
      await service.invalidateUserAnalysis(USER_ID);
      expect(cache.del).toHaveBeenCalledTimes(1);
      expect(cache.del).toHaveBeenCalledWith(`analysis:exams:${USER_ID}`);
    });
  });

  describe('pathways', () => {
    it('NO_ATTEMPTS when the student has no completed full mock', async () => {
      const { result } = await run({
        rows: [],
        offerings: [offering(MBBS, 'MBBS', { subtitle: 'Medicine' })],
      });
      const [p] = result.pathways.offerings;
      expect(p.status).toBe('NO_ATTEMPTS');
      expect(p.yourMarks).toBeNull();
      expect(p.cutoffMarks).toBeNull();
      expect(p.comfortMarks).toBeNull();
      expect(p.gapMarks).toBeNull();
      expect(p.attemptsConsidered).toBe(0);
      expect(p.attemptsInWindow).toBe(0);
      expect(p.progress01).toBe(0);
      expect(p.subtitle).toBe('Medicine');
      expect(p.message).toMatch(/Attempt a full mock/);
      expect(result.pathways.averagePercent).toBeNull();
      expect(result.pathways.attemptCountUsed).toBe(0);
      // no attempts => no need to look the mocks up
      expect(mockTestModel.find).not.toHaveBeenCalled();
    });

    it('NO_CUTOFF shows weighted marks but no band when no mock has a cut-off', async () => {
      const m1 = oid(1);
      const m2 = oid(2);
      const { result } = await run({
        // newest first: 620 (m2) then 500 (m1) -> weights newest=2, oldest=1
        rows: [
          attempt({ score: 620, mock: m2 }),
          attempt({ score: 500, mock: m1 }),
        ],
        mocks: [{ _id: m1 }, { _id: m2, courseCutoffs: [] }],
      });
      const [p] = result.pathways.offerings;
      expect(p.status).toBe('NO_CUTOFF');
      // (500*1 + 620*2) / 3 = 580
      expect(p.yourMarks).toBe(580);
      expect(p.cutoffMarks).toBeNull();
      expect(p.gapMarks).toBeNull();
      expect(p.comfortMarks).toBeNull();
      expect(p.attemptsConsidered).toBe(2);
      expect(p.attemptsInWindow).toBe(2);
      expect(p.progress01).toBe(0);
      expect(p.message).toBe(
        'Cut-off not announced yet for your recent mocks.',
      );
    });

    it('computes recency-weighted marks and cut-off (oldest 1 ... newest n)', async () => {
      const [m1, m2, m3] = [oid(1), oid(2), oid(3)];
      const { result } = await run({
        rows: [
          attempt({ score: 620, mock: m3 }),
          attempt({ score: 560, mock: m2 }),
          attempt({ score: 500, mock: m1 }),
        ],
        mocks: [
          cutoffsFor(m1, [MBBS, 600]),
          cutoffsFor(m2, [MBBS, 620]),
          cutoffsFor(m3, [MBBS, 640]),
        ],
      });
      const [p] = result.pathways.offerings;
      expect(p.status).toBe('EVALUATED');
      // (500*1 + 560*2 + 620*3) / 6 = 580
      expect(p.yourMarks).toBe(580);
      // (600*1 + 620*2 + 640*3) / 6 = 626.67
      expect(p.cutoffMarks).toBe(626.67);
      expect(p.gapMarks).toBe(-46.67);
      expect(p.comfortMarks).toBe(658.0); // 626.67 * 1.05 = 658.0035 -> 658
      expect(p.band).toBe('below');
      expect(p.attemptsConsidered).toBe(3);
      expect(p.attemptsInWindow).toBe(3);
      expect(p.maxMarks).toBe(720);
      expect(p.progress01).toBeCloseTo(580 / 626.67, 4);
      expect(p.message).toBe(
        '46.7 marks below the cut-off — a strong stretch, keep climbing.',
      );
    });

    it('keeps positional weights when the newest mock has no cut-off for the course', async () => {
      const [m1, m2, m3] = [oid(1), oid(2), oid(3)];
      const { result } = await run({
        rows: [
          attempt({ score: 620, mock: m3 }), // newest, no MBBS cut-off
          attempt({ score: 560, mock: m2 }),
          attempt({ score: 500, mock: m1 }),
        ],
        mocks: [
          cutoffsFor(m1, [MBBS, 600]),
          cutoffsFor(m2, [MBBS, 620]),
          { _id: m3 },
        ],
      });
      const [p] = result.pathways.offerings;
      // weights stay 1,2 for m1,m2 (m3's weight of 3 is dropped, not redistributed)
      expect(p.yourMarks).toBe(540); // (500 + 1120) / 3
      expect(p.cutoffMarks).toBe(613.33); // (600 + 1240) / 3
      expect(p.attemptsConsidered).toBe(2);
      expect(p.attemptsInWindow).toBe(3);
    });

    it('evaluates each course against its own cut-offs', async () => {
      const m1 = oid(1);
      const { result } = await run({
        rows: [attempt({ score: 630, mock: m1 })],
        mocks: [cutoffsFor(m1, [MBBS, 620], [BDS, 700])],
        offerings: [offering(MBBS, 'MBBS'), offering(BDS, 'BDS')],
      });
      const [mbbs, bds] = result.pathways.offerings;
      expect(mbbs.band).toBe('borderline'); // 630 >= 620 and < 651
      expect(mbbs.gapMarks).toBe(10);
      expect(mbbs.comfortMarks).toBe(651);
      expect(mbbs.message).toBe(
        'Just above the cut-off — 21 marks more would make it steadier.',
      );
      expect(bds.band).toBe('below');
      expect(bds.gapMarks).toBe(-70);
    });

    it('one course can be EVALUATED while another is NO_CUTOFF', async () => {
      const m1 = oid(1);
      const { result } = await run({
        rows: [attempt({ score: 660, mock: m1 })],
        mocks: [cutoffsFor(m1, [MBBS, 620])],
        offerings: [offering(MBBS, 'MBBS'), offering(BDS, 'BDS')],
      });
      expect(result.pathways.offerings[0].status).toBe('EVALUATED');
      expect(result.pathways.offerings[0].band).toBe('comfortable');
      expect(result.pathways.offerings[0].progress01).toBe(1);
      expect(result.pathways.offerings[1].status).toBe('NO_CUTOFF');
      expect(result.pathways.offerings[1].yourMarks).toBe(660);
    });

    it('treats exactly the cut-off as borderline and exactly cut-off x1.05 as comfortable', async () => {
      const m1 = oid(1);
      const atCutoff = await run({
        rows: [attempt({ score: 620, mock: m1 })],
        mocks: [cutoffsFor(m1, [MBBS, 620])],
      });
      expect(atCutoff.result.pathways.offerings[0].band).toBe('borderline');
      expect(atCutoff.result.pathways.offerings[0].gapMarks).toBe(0);

      jest.clearAllMocks();
      cache.get.mockResolvedValue(undefined);
      const atComfort = await run({
        rows: [attempt({ score: 630, mock: m1 })],
        mocks: [cutoffsFor(m1, [MBBS, 600])],
      });
      expect(atComfort.result.pathways.offerings[0].band).toBe('comfortable');
    });

    it('works on a 300-mark scale (JEE) without any hard-coded total', async () => {
      const m1 = oid(1);
      const { result } = await run({
        rows: [attempt({ score: 240, mock: m1, questions: 75, marks: 4 })],
        mocks: [cutoffsFor(m1, [MBBS, 250])],
        examTotalMarks: 300,
      });
      const [p] = result.pathways.offerings;
      expect(p.maxMarks).toBe(300);
      expect(p.band).toBe('below');
      expect(p.gapMarks).toBe(-10);
      expect(p.progress01).toBeCloseTo(0.96, 4);
      // legacy derived percents use the real scale
      expect(p.minPercent).toBeCloseTo(83.3, 1);
      expect(p.userPercent).toBe(80);
    });

    it('uses the latest attempt max score for maxMarks, falling back to exam total', async () => {
      const m1 = oid(1);
      const first = await run({
        rows: [attempt({ score: 100, mock: m1, questions: 50, marks: 4 })],
        mocks: [cutoffsFor(m1, [MBBS, 150])],
        examTotalMarks: 720,
      });
      expect(first.result.pathways.offerings[0].maxMarks).toBe(200);

      jest.clearAllMocks();
      cache.get.mockResolvedValue(undefined);
      const none = await run({ rows: [], examTotalMarks: 720 });
      expect(none.result.pathways.offerings[0].maxMarks).toBe(720);

      jest.clearAllMocks();
      cache.get.mockResolvedValue(undefined);
      const noTotal = await run({ rows: [], examTotalMarks: null });
      expect(noTotal.result.pathways.offerings[0].maxMarks).toBeNull();
    });

    it('computes max score from per-question marks on mixed-marks papers', async () => {
      const m1 = oid(1);
      const { result } = await run({
        rows: [
          attempt({
            score: 9,
            mock: m1,
            perQuestion: [4, 4, 1, 1, 1],
            marks: 4, // first subject's marks, as stored on full-mock attempts
          }),
        ],
      });
      expect(result.fullMocks.latest?.maxScore).toBe(11);
      expect(result.fullMocks.latest?.percent).toBeCloseTo(81.8, 1);
    });

    it('falls back to totalQuestions x marks when an attempt has no question marks', async () => {
      const row = attempt({ score: 50, mock: oid(1), questions: 0, marks: 4 });
      row.totalQuestions = 25;
      const { result } = await run({ rows: [row] });
      expect(result.fullMocks.latest?.maxScore).toBe(100);
      expect(result.fullMocks.latest?.percent).toBe(50);
    });

    it('ignores cut-offs for other courses, invalid values, and mocks without ids', async () => {
      const [m1, m2, m3] = [oid(1), oid(2), oid(3)];
      const { result } = await run({
        rows: [
          attempt({ score: 600, mock: m3 }),
          attempt({ score: 600, mock: m2 }),
          attempt({ score: 600, mock: null }),
          attempt({ score: 600, mock: m1 }),
        ],
        mocks: [
          cutoffsFor(m1, [BDS, 500]), // different course
          cutoffsFor(m2, [MBBS, 0]), // not positive
          cutoffsFor(m3, [MBBS, Number.NaN]), // not finite
        ],
      });
      const [p] = result.pathways.offerings;
      expect(p.status).toBe('NO_CUTOFF');
      expect(p.attemptsConsidered).toBe(4);
    });

    it('ignores attempts whose mock was deleted (no document returned)', async () => {
      const m1 = oid(1);
      const { result } = await run({
        rows: [attempt({ score: 600, mock: m1 })],
        mocks: [], // soft-deleted mocks are filtered out by the schema hook
      });
      expect(result.pathways.offerings[0].status).toBe('NO_CUTOFF');
    });

    it('uses only the latest 10 attempts and asks the database for exactly 10', async () => {
      const mocks = Array.from({ length: 10 }, (_, i) => oid(i + 1));
      // newest first: scores 100..10 (newest = 100) -> oldest = 10
      const rows = mocks.map((m, i) =>
        attempt({ score: (10 - i) * 10, mock: m }),
      );
      const { result, fullMockChain } = await run({
        rows,
        mocks: mocks.map(m => cutoffsFor(m, [MBBS, 80])),
        total: 14,
      });
      expect(fullMockChain.limit).toHaveBeenCalledWith(10);
      const [p] = result.pathways.offerings;
      expect(p.attemptsInWindow).toBe(10);
      expect(p.attemptsConsidered).toBe(10);
      // weights: newest (score 100) -> 10 ... oldest (score 10) -> 1; sum = 55
      // sum(score*weight) = sum_{k=1..10} (10k)*k = 10 * 385 = 3850 => 70
      expect(p.yourMarks).toBe(70);
      expect(p.cutoffMarks).toBe(80);
      // chart + counters are unchanged: capped at 5, target 5
      expect(result.fullMocks.recent).toHaveLength(5);
      expect(result.fullMocks.completedCount).toBe(14);
      expect(result.fullMocks.targetCount).toBe(5);
      expect(result.fullMocks.needsMoreAttempts).toBe(false);
      expect(result.pathways.attemptCountUsed).toBe(10);
    });

    it('recent chart is oldest -> newest with Mock 1..n labels (unchanged behaviour)', async () => {
      const rows = [
        attempt({ score: 300, title: 'C', day: 3 }),
        attempt({ score: 200, title: '', day: 2 }),
        attempt({ score: 100, title: 'A', day: 1 }),
      ];
      const { result } = await run({ rows });
      expect(result.fullMocks.recent.map(r => r.label)).toEqual([
        'Mock 1',
        'Mock 2',
        'Mock 3',
      ]);
      expect(result.fullMocks.recent.map(r => r.score)).toEqual([
        100, 200, 300,
      ]);
      expect(result.fullMocks.recent[1].title).toBe('Mock 2'); // blank title falls back
      expect(result.fullMocks.latest?.score).toBe(300);
      expect(result.fullMocks.latest?.deltaFromPrevious).toBe(100);
      expect(result.fullMocks.needsMoreAttempts).toBe(true);
      expect(result.engagement.fullMocksRemaining).toBe(2);
    });

    it('derives legacy percent fields and averagePercent for older clients', async () => {
      const m1 = oid(1);
      const { result } = await run({
        rows: [attempt({ score: 540, mock: m1 })],
        mocks: [cutoffsFor(m1, [MBBS, 576])],
      });
      const [p] = result.pathways.offerings;
      expect(p.minPercent).toBe(80); // 576 / 720
      expect(p.comfortPercent).toBe(84); // 604.8 / 720
      expect(p.userPercent).toBe(75); // 540 / 720
      expect(result.pathways.averagePercent).toBe(75);
    });

    it('falls back to the legacy stored percents when marks cannot be derived', async () => {
      const { result } = await run({
        rows: [],
        examTotalMarks: null,
        offerings: [
          offering(MBBS, 'MBBS', { minPercent: 70, comfortPercent: 85 }),
          offering(BDS, 'BDS', { minPercent: 60 }),
          offering('64f123456789abcdef1234cc', 'Vet'),
        ],
      });
      const [a, b, c] = result.pathways.offerings;
      expect([a.minPercent, a.comfortPercent]).toEqual([70, 85]);
      expect([b.minPercent, b.comfortPercent]).toEqual([60, 60]);
      expect([c.minPercent, c.comfortPercent]).toEqual([0, 0]);
      expect(a.userPercent).toBeNull();
    });

    it('returns no pathways when the exam has no active courses', async () => {
      const { result } = await run({ rows: [], offerings: [] });
      expect(result.pathways.offerings).toEqual([]);
    });
  });

  describe('latest full mock summary', () => {
    it('counts correct / incorrect / skipped on the newest attempt', async () => {
      const row = attempt({ score: 548, title: 'Mock 12', questions: 0 });
      row.questions = [
        { selectedOption: 'A', isCorrect: true, marksPerQuestion: 4 },
        { selectedOption: 'B', isCorrect: false, marksPerQuestion: 4 },
        {
          selectedOption: null as unknown as string,
          isCorrect: false,
          marksPerQuestion: 4,
        },
      ];
      row.totalQuestions = 3;
      const { result } = await run({ rows: [row] });
      expect(result.fullMocks.latest).toMatchObject({
        title: 'Mock 12',
        score: 548,
        correctCount: 1,
        incorrectCount: 1,
        skippedCount: 1,
      });
      expect(result.engagement.hasFullMocks).toBe(true);
    });
  });

  describe('chapter-wise insights (unchanged, percent based)', () => {
    it('summarises subjects and weak/strong topics', async () => {
      const subject = { _id: oid(100), name: 'Physics' };
      const strong = { _id: oid(200), name: 'Optics' };
      const weak = { _id: oid(201), name: 'Thermo' };
      const { result } = await run({
        rows: [],
        chapterRows: [
          {
            score: 36,
            totalQuestions: 10,
            marksPerQuestion: 4,
            subject,
            topic: strong,
          },
          {
            score: 12,
            totalQuestions: 10,
            marksPerQuestion: 4,
            subject,
            topic: weak,
          },
        ],
      });
      expect(result.subjects.attemptCount).toBe(2);
      expect(result.subjects.needsMoreAttempts).toBe(false);
      const [item] = result.subjects.items;
      expect(item.subjectName).toBe('Physics');
      expect(item.averagePercent).toBe(60); // (90 + 30) / 2
      expect(item.strengthLabel).toBe('Good');
      expect(item.topics[0]).toMatchObject({
        topicName: 'Thermo',
        isWeak: true,
        isStrong: false,
      });
      expect(item.topics[1]).toMatchObject({
        topicName: 'Optics',
        isStrong: true,
      });
      expect(item.tip).toBe('Thermo needs another look before your next mock.');
    });

    it('labels strong subjects and weak subjects with the right tips', async () => {
      const strongSubject = { _id: oid(100), name: 'Chemistry' };
      const weakSubject = { _id: oid(101), name: 'Biology' };
      const { result } = await run({
        rows: [],
        chapterRows: [
          {
            score: 36,
            totalQuestions: 10,
            marksPerQuestion: 4,
            subject: strongSubject,
          },
          {
            score: 20,
            totalQuestions: 10,
            marksPerQuestion: 4,
            subject: weakSubject,
          },
        ],
      });
      const byName = Object.fromEntries(
        result.subjects.items.map(i => [i.subjectName, i]),
      );
      expect(byName.Chemistry.strengthLabel).toBe('Strong');
      expect(byName.Chemistry.tip).toBe(
        'Keep Chemistry sharp with a short recall session.',
      );
      expect(byName.Biology.strengthLabel).toBe('Good'); // 50%
      expect(byName.Biology.tip).toBe(
        'Steady chapter-wise practice will lift Biology.',
      );
    });

    it('needsMoreAttempts when there are no chapter-wise attempts', async () => {
      const { result } = await run({ rows: [] });
      expect(result.subjects).toMatchObject({
        attemptCount: 0,
        needsMoreAttempts: true,
        items: [],
      });
      expect(result.engagement.hasChapterWise).toBe(false);
      expect(result.engagement.hasFullMocks).toBe(false);
    });
  });
});
