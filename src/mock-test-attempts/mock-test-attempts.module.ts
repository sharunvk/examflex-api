import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MockTestAttemptsService } from './mock-test-attempts.service';
import { MockTestAttemptsController } from './mock-test-attempts.controller';
import {
  MockTestAttempt,
  MockTestAttemptSchema,
} from './schemas/mock-test-attempt.schema';
import { Question, QuestionSchema } from './schemas/question.schema';
import { MockTestsModule } from '../mock-tests/mock-tests.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { AccessModule } from '../access/access-control.module';
import { MistakeBookModule } from '../mistake-book/mistake-book.module';
import { TodayModule } from '../today/today.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MockTestAttempt.name, schema: MockTestAttemptSchema },
      { name: Question.name, schema: QuestionSchema },
    ]),
    MockTestsModule, // Import to access MockTest model
    AnalyticsModule, // Import to drop cached analytics when an attempt closes
    AnalysisModule, // Drop Analysis overview cache when an attempt closes
    TodayModule, // Drop Today dashboard cache when an attempt closes
    AccessModule,
    MistakeBookModule,
  ],
  controllers: [MockTestAttemptsController],
  providers: [MockTestAttemptsService],
  exports: [MockTestAttemptsService],
})
export class MockTestAttemptsModule {}
