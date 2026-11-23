import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Question,
  QuestionDocument,
} from '../../mock-test-attempts/schemas/question.schema';
import { ImportQuestion } from '../types/import-question';
import { createdByFields } from '../../common/types/to-actor-object-id';
import { QuestionCitationsService } from '../../citations/question-citations.service';

@Injectable()
export class QuestionPersistenceService {
  private readonly logger = new Logger(QuestionPersistenceService.name);

  constructor(
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    private readonly citations: QuestionCitationsService,
  ) {}

  async saveOne(
    question: ImportQuestion,
    actorUserId?: string,
  ): Promise<QuestionDocument> {
    const payload = {
      ...this.toDocumentPayload(question),
      ...createdByFields(actorUserId),
    };

    try {
      const created = await this.questionModel.create(payload);
      this.logger.log(`[persist] Saved question ${created._id.toString()}`);
      // Background lookup: never blocks or fails the import.
      void this.citations.autoAttach(created._id.toString());
      return created;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      throw new Error(`Failed to save question to database: ${message}`);
    }
  }

  private toDocumentPayload(question: ImportQuestion) {
    return {
      questionText: {
        en: {
          text: question.questionText.en.text ?? undefined,
          image: question.questionText.en.image ?? undefined,
        },
        ml: {
          text: null,
          image: null,
        },
      },
      optionType: question.optionType,
      options: question.options.map(option => ({
        id: option.id,
        type: option.type,
        en: option.en,
        ml: option.ml,
        image: option.image ?? undefined,
      })),
      explanation: {
        en: question.explanation.en,
        ml: question.explanation.ml,
        image: question.explanation.image ?? undefined,
        ...(question.explanation.images?.length
          ? { images: question.explanation.images }
          : {}),
      },
      correctAnswer: question.correctAnswer,
      subject: new Types.ObjectId(question.subject),
      topic: new Types.ObjectId(question.topic),
      exams: question.exams.map(examId => new Types.ObjectId(examId)),
      ...this.tagDocumentFields(question),
      difficultyLevel: question.difficultyLevel,
      isActive: true,
      isDeleted: false,
      source: question.source,
      ...(question.uploadId
        ? { uploadId: new Types.ObjectId(question.uploadId) }
        : {}),
    };
  }

  /**
   * Writes tags only when at least one was selected. A question with no tag
   * omits the field instead of storing an empty array.
   */
  private tagDocumentFields(question: ImportQuestion) {
    const ids = [
      ...new Set(
        (question.tags ?? []).filter(
          id => typeof id === 'string' && id.length > 0,
        ),
      ),
    ];

    if (ids.length === 0) {
      return {};
    }

    return {
      tags: ids.map(id => new Types.ObjectId(id)),
    };
  }
}
