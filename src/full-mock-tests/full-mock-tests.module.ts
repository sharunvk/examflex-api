import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FullMockTestsController } from './full-mock-tests.controller';
import { FullMockTestsService } from './full-mock-tests.service';
import { FullMockSelectionService } from './full-mock-selection.service';
import {
  FullMockTestDraft,
  FullMockTestDraftSchema,
} from './schemas/full-mock-test-draft.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Topic, TopicSchema } from '../topics/schemas/topic.schema';
import {
  Question,
  QuestionSchema,
} from '../mock-test-attempts/schemas/question.schema';
import {
  RecommendationOffering,
  RecommendationOfferingSchema,
} from '../recommendations/schemas/recommendation-offering.schema';
import { MockTestsModule } from '../mock-tests/mock-tests.module';
import { AccessModule } from '../access/access-control.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FullMockTestDraft.name, schema: FullMockTestDraftSchema },
      { name: Exam.name, schema: ExamSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Topic.name, schema: TopicSchema },
      { name: Question.name, schema: QuestionSchema },
      {
        name: RecommendationOffering.name,
        schema: RecommendationOfferingSchema,
      },
    ]),
    MockTestsModule,
    AccessModule,
  ],
  controllers: [FullMockTestsController],
  providers: [FullMockTestsService, FullMockSelectionService],
  exports: [FullMockTestsService],
})
export class FullMockTestsModule {}
