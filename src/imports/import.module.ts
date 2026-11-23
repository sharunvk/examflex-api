import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { MarkdownParserService } from './parser/markdown-parser.service';
import { QuestionParserService } from './parser/question-parser.service';
import { SolutionParserService } from './parser/solution-parser.service';
import { QuestionMatcherService } from './parser/question-matcher.service';
import { AdaptiveBoundaryStrategy } from './parser/boundaries/adaptive-boundary.strategy';
import { AdaptiveParserStrategy } from './parser/strategies/adaptive-parser.strategy';
import { DocumentParserFactory } from './parser/factories/document-parser.factory';
import { StructureDetectorService } from './parser/structure-detector.service';
import { DeepseekService } from './llm/deepseek.service';
import { AiOutputValidator } from './validators/ai-output.validator';
import { BusinessValidator } from './validators/business.validator';
import { QuestionMapper } from './mapper/question.mapper';
import { MarkdownImageExtractorService } from './mapper/markdown-image.extractor';
import { ImportImageStorageService } from './images/import-image-storage.service';
import { QuestionChunkerService } from './chunking/question-chunker.service';
import { PersistQuestionValidator } from './validators/persist-question.validator';
import { QuestionPersistenceService } from './persistence/question-persistence.service';
import { FailedQuestionService } from './persistence/failed-question.service';
import {
  Question,
  QuestionSchema,
} from '../mock-test-attempts/schemas/question.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Topic, TopicSchema } from '../topics/schemas/topic.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { Tag, TagSchema } from '../tags/schemas/tag.schema';
import {
  QuestionUpload,
  QuestionUploadSchema,
} from './schemas/question-upload.schema';
import {
  FailedQuestion,
  FailedQuestionSchema,
} from './schemas/failed-question.schema';
import { AwsModule } from '../aws/aws.module';
import { MathpixModule } from '../integrations/mathpix/mathpix.module';
import { ImportQueueModule } from '../queues/import-queue.module';
import { CitationsModule } from '../citations/citations.module';
import { PromptEnhancerRegistry } from './prompt-enhancers/prompt-enhancer.registry';
import { PromptEnhancerComposer } from './prompt-enhancers/prompt-enhancer.composer';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Question.name, schema: QuestionSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Topic.name, schema: TopicSchema },
      { name: Exam.name, schema: ExamSchema },
      { name: Tag.name, schema: TagSchema },
      { name: QuestionUpload.name, schema: QuestionUploadSchema },
      { name: FailedQuestion.name, schema: FailedQuestionSchema },
    ]),
    AwsModule,
    MathpixModule,
    CitationsModule,
    forwardRef(() => ImportQueueModule),
  ],
  controllers: [ImportController],
  providers: [
    ImportService,
    MarkdownParserService,
    QuestionParserService,
    SolutionParserService,
    QuestionMatcherService,
    AdaptiveBoundaryStrategy,
    AdaptiveParserStrategy,
    DocumentParserFactory,
    StructureDetectorService,
    PromptEnhancerRegistry,
    PromptEnhancerComposer,
    DeepseekService,
    AiOutputValidator,
    BusinessValidator,
    QuestionMapper,
    MarkdownImageExtractorService,
    ImportImageStorageService,
    QuestionChunkerService,
    PersistQuestionValidator,
    QuestionPersistenceService,
    FailedQuestionService,
  ],
  exports: [ImportService],
})
export class ImportModule {}
