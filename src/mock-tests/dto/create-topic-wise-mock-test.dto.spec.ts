import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { CreateTopicWiseMockTestDto } from './create-topic-wise-mock-test.dto';

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    totalQuestions: 10,
    durationInMinutes: 10,
    exam: '64f123456789abcdef123456',
    subject: '64f123456789abcdef123457',
    // Topic is required for TOPIC_WISE papers (subject-wide papers are not allowed).
    topic: '64f123456789abcdef123458',
    difficultyDistribution: { easy: 4, medium: 4, hard: 2 },
    ...overrides,
  };
}

describe('CreateTopicWiseMockTestDto', () => {
  describe('topic', () => {
    it('rejects omitted topic', async () => {
      const { topic: _omit, ...withoutTopic } = basePayload();
      const dto = plainToInstance(CreateTopicWiseMockTestDto, withoutTopic);
      const errors = await validate(dto);
      expect(errors.some(error => error.property === 'topic')).toBe(true);
    });

    it('rejects a non-ObjectId topic', async () => {
      const dto = plainToInstance(
        CreateTopicWiseMockTestDto,
        basePayload({ topic: 'not-an-id' }),
      );
      const errors = await validate(dto);
      expect(errors.some(error => error.property === 'topic')).toBe(true);
    });
  });

  describe('accessMode', () => {
    it('accepts FREE', async () => {
      const dto = plainToInstance(
        CreateTopicWiseMockTestDto,
        basePayload({ accessMode: AccessMode.FREE }),
      );
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.accessMode).toBe(AccessMode.FREE);
    });

    it('accepts ENTITLED', async () => {
      const dto = plainToInstance(
        CreateTopicWiseMockTestDto,
        basePayload({ accessMode: AccessMode.ENTITLED }),
      );
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.accessMode).toBe(AccessMode.ENTITLED);
    });

    it('accepts omitted accessMode (schema default FREE)', async () => {
      const dto = plainToInstance(CreateTopicWiseMockTestDto, basePayload());
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.accessMode).toBeUndefined();
    });

    it('rejects invalid accessMode', async () => {
      const dto = plainToInstance(
        CreateTopicWiseMockTestDto,
        basePayload({ accessMode: 'PAID' }),
      );
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(error => error.property === 'accessMode')).toBe(true);
    });
  });
});
