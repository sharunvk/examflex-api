import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalysisModule } from '../analysis/analysis.module';
import { MistakeBookModule } from '../mistake-book/mistake-book.module';
import {
  MockTest,
  MockTestSchema,
} from '../mock-tests/schemas/mock-test.schema';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';

@Module({
  imports: [
    CacheModule.register(),
    MongooseModule.forFeature([
      { name: MockTest.name, schema: MockTestSchema },
    ]),
    AnalysisModule,
    MistakeBookModule,
  ],
  controllers: [TodayController],
  providers: [TodayService],
  exports: [TodayService],
})
export class TodayModule {}
