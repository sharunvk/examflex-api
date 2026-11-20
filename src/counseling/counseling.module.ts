import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminCounselingController } from './admin-counseling.controller';
import { CounselingController } from './counseling.controller';
import { CounselingService } from './counseling.service';
import {
  CounselingRequest,
  CounselingRequestSchema,
} from './schemas/counseling-request.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CounselingRequest.name, schema: CounselingRequestSchema },
    ]),
  ],
  controllers: [CounselingController, AdminCounselingController],
  providers: [CounselingService],
  exports: [CounselingService],
})
export class CounselingModule {}
