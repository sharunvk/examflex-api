import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Question,
  QuestionSchema,
} from '../mock-test-attempts/schemas/question.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import {
  InstanceConfig,
  InstanceConfigSchema,
} from '../instance-config/schemas/instance-config.schema';
import { NcertSearchService } from './ncert-search.service';
import { QuestionCitationsService } from './question-citations.service';
import { QuestionCitationsController } from './question-citations.controller';

/** NCERT citations for questions, backed by the Weaviate NCERT collection. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Question.name, schema: QuestionSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: InstanceConfig.name, schema: InstanceConfigSchema },
    ]),
  ],
  controllers: [QuestionCitationsController],
  providers: [NcertSearchService, QuestionCitationsService],
  exports: [QuestionCitationsService],
})
export class CitationsModule {}
