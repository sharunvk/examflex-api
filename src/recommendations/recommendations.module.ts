import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import {
  RecommendationOffering,
  RecommendationOfferingSchema,
} from './schemas/recommendation-offering.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: RecommendationOffering.name,
        schema: RecommendationOfferingSchema,
      },
      { name: Exam.name, schema: ExamSchema },
    ]),
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
