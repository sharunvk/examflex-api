import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MockTestAttempt,
  MockTestAttemptSchema,
} from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import {
  Question,
  QuestionSchema,
} from '../mock-test-attempts/schemas/question.schema';
import {
  MockTest,
  MockTestSchema,
} from '../mock-tests/schemas/mock-test.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Topic, TopicSchema } from '../topics/schemas/topic.schema';
import { MistakeBookController } from './mistake-book.controller';
import { MistakeBookService } from './mistake-book.service';
import {
  MistakeBookEntry,
  MistakeBookEntrySchema,
} from './schemas/mistake-book-entry.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MistakeBookEntry.name, schema: MistakeBookEntrySchema },
      { name: MockTestAttempt.name, schema: MockTestAttemptSchema },
      { name: MockTest.name, schema: MockTestSchema },
      { name: Question.name, schema: QuestionSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Topic.name, schema: TopicSchema },
    ]),
  ],
  controllers: [MistakeBookController],
  providers: [MistakeBookService],
  exports: [MistakeBookService],
})
export class MistakeBookModule {}
