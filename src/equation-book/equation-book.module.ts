import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Topic, TopicSchema } from '../topics/schemas/topic.schema';
import { EquationBookController } from './equation-book.controller';
import { EquationBookService } from './equation-book.service';
import { Equation, EquationSchema } from './schemas/equation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Equation.name, schema: EquationSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Topic.name, schema: TopicSchema },
      { name: Exam.name, schema: ExamSchema },
    ]),
  ],
  controllers: [EquationBookController],
  providers: [EquationBookService],
  exports: [EquationBookService, MongooseModule],
})
export class EquationBookModule {}
