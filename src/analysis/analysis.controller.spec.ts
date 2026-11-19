import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

describe('AnalysisController', () => {
  let controller: AnalysisController;
  const analysisService = {
    getOverview: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalysisController],
      providers: [{ provide: AnalysisService, useValue: analysisService }],
    }).compile();
    controller = module.get(AnalysisController);
    jest.clearAllMocks();
  });

  it('wraps overview result', async () => {
    const data = { exam: { id: 'e1', name: 'NEET' } };
    analysisService.getOverview.mockResolvedValue(data);
    const result = await controller.getOverview({ id: 'u1' } as never, 'e1');
    expect(result.message).toMatch(/retrieved/i);
    expect(result.data).toEqual(data);
    expect(analysisService.getOverview).toHaveBeenCalledWith('u1', 'e1');
  });
});
