import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MockTestsService } from './mock-tests.service';
import { MockTestsController } from './mock-tests.controller';
import { MockTest, MockTestSchema } from './schemas/mock-test.schema';
import {
  TopicWiseMockTestDraft,
  TopicWiseMockTestDraftSchema,
} from './schemas/topic-wise-mock-test-draft.schema';
import { TopicWiseDraftsController } from './topic-wise-drafts.controller';
import { TopicWiseDraftsService } from './topic-wise-drafts.service';
import { SubjectsModule } from '../subjects/subjects.module';
import { TopicsModule } from '../topics/topics.module';
import { ExamsModule } from '../exams/exams.module';
import {
  MockTestAttempt,
  MockTestAttemptSchema,
} from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import {
  Question,
  QuestionSchema,
} from '../mock-test-attempts/schemas/question.schema';
import { AccessModule } from '../access/access-control.module';
import { MistakeBookModule } from '../mistake-book/mistake-book.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MockTest.name, schema: MockTestSchema },
      { name: MockTestAttempt.name, schema: MockTestAttemptSchema },
      { name: Question.name, schema: QuestionSchema },
      {
        name: TopicWiseMockTestDraft.name,
        schema: TopicWiseMockTestDraftSchema,
      },
    ]),
    SubjectsModule,
    TopicsModule,
    ExamsModule,
    forwardRef(() => AccessModule),
    MistakeBookModule,
  ],
  // Drafts must be registered first. Otherwise GET /mock-tests/:id
  // captures /mock-tests/drafts and Mongoose rejects the id "drafts".
  controllers: [TopicWiseDraftsController, MockTestsController],
  providers: [MockTestsService, TopicWiseDraftsService],
  exports: [
    MockTestsService,
    MongooseModule.forFeature([
      { name: MockTest.name, schema: MockTestSchema },
    ]),
  ], // Export service and model for use in other modules
})
export class MockTestsModule {}
