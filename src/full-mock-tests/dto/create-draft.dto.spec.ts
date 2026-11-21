import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDraftDto } from './create-draft.dto';

const EXAM = '507f1f77bcf86cd799439015';
const SUB = '507f1f77bcf86cd799439011';

async function errorsFor(payload: unknown) {
  return validate(plainToInstance(CreateDraftDto, payload));
}

describe('CreateDraftDto', () => {
  it('accepts a body with only examId (legacy)', async () => {
    expect(await errorsFor({ examId: EXAM })).toHaveLength(0);
  });

  it('accepts a valid per-subject split', async () => {
    const errors = await errorsFor({
      examId: EXAM,
      difficultyDistribution: [{ subjectId: SUB, easy: 5, medium: 3, hard: 2 }],
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects negative, fractional and malformed entries', async () => {
    expect(
      await errorsFor({
        examId: EXAM,
        difficultyDistribution: [
          { subjectId: SUB, easy: -1, medium: 0, hard: 0 },
        ],
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({
        examId: EXAM,
        difficultyDistribution: [
          { subjectId: SUB, easy: 1.5, medium: 0, hard: 0 },
        ],
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({
        examId: EXAM,
        difficultyDistribution: [
          { subjectId: 'nope', easy: 1, medium: 0, hard: 0 },
        ],
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({ examId: EXAM, difficultyDistribution: [] }),
    ).not.toHaveLength(0);
  });
});
