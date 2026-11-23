import { QuestionCitationsController } from './question-citations.controller';
import { QuestionCitationsService } from './question-citations.service';

describe('QuestionCitationsController', () => {
  const service = {
    getCitations: jest.fn().mockResolvedValue({ citations: [] }),
    searchForQuestion: jest.fn().mockResolvedValue({ results: [] }),
    saveSelection: jest
      .fn()
      .mockResolvedValue({ citations: [{ chunkId: 'a' }] }),
    refresh: jest.fn().mockResolvedValue({ citations: [] }),
  };
  const controller = new QuestionCitationsController(
    service as unknown as QuestionCitationsService,
  );

  it('delegates each route to the service', async () => {
    await expect(controller.get('q1')).resolves.toMatchObject({
      data: { citations: [] },
    });
    expect(service.getCitations).toHaveBeenCalledWith('q1');

    await controller.search('q1', { limit: 5, q: 'x' });
    expect(service.searchForQuestion).toHaveBeenCalledWith('q1', {
      limit: 5,
      q: 'x',
    });

    await expect(
      controller.save('q1', { chunkIds: ['a'] }),
    ).resolves.toMatchObject({
      data: { citations: [{ chunkId: 'a' }] },
    });
    expect(service.saveSelection).toHaveBeenCalledWith('q1', ['a']);

    await controller.refresh('q1');
    expect(service.refresh).toHaveBeenCalledWith('q1');
  });
});
