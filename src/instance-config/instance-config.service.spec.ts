import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InstanceConfigService } from './instance-config.service';
import { InstanceConfig } from './schemas/instance-config.schema';
import { INSTANCE_CONFIG_ID } from './instance-config.constants';

function chain(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

function stored(overrides: Record<string, unknown> = {}) {
  return {
    _id: INSTANCE_CONFIG_ID,
    schemaVersion: 1,
    name: 'EZ Prep',
    logoUrl: 'https://cdn.example.com/logo.png',
    faviconUrl: 'https://cdn.example.com/favicon.png',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('InstanceConfigService', () => {
  let service: InstanceConfigService;
  const model: any = {
    findById: jest.fn(),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceConfigService,
        { provide: getModelToken(InstanceConfig.name), useValue: model },
      ],
    }).compile();
    service = module.get(InstanceConfigService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('returns null when this instance has not been configured', async () => {
      model.findById.mockReturnValue(chain(null));
      await expect(service.get()).resolves.toBeNull();
      expect(model.findById).toHaveBeenCalledWith(INSTANCE_CONFIG_ID);
    });

    it('returns the singleton branding document', async () => {
      model.findById.mockReturnValue(chain(stored()));
      await expect(service.get()).resolves.toMatchObject({
        id: INSTANCE_CONFIG_ID,
        schemaVersion: 1,
        name: 'EZ Prep',
        logoUrl: 'https://cdn.example.com/logo.png',
        faviconUrl: 'https://cdn.example.com/favicon.png',
      });
    });

    it('returns null urls when they were never set', async () => {
      model.findById.mockReturnValue(
        chain(stored({ logoUrl: undefined, faviconUrl: undefined })),
      );
      const result = await service.get();
      expect(result.logoUrl).toBeNull();
      expect(result.faviconUrl).toBeNull();
    });
  });

  describe('create', () => {
    it('creates the singleton with only the urls that were provided', async () => {
      model.findById.mockReturnValue(chain(null));
      model.create.mockResolvedValue(stored({ faviconUrl: undefined }));

      const result = await service.create({
        name: 'EZ Prep',
        logoUrl: 'https://cdn.example.com/logo.png',
        faviconUrl: null,
      });

      expect(model.create).toHaveBeenCalledWith({
        _id: INSTANCE_CONFIG_ID,
        schemaVersion: 1,
        name: 'EZ Prep',
        logoUrl: 'https://cdn.example.com/logo.png',
      });
      expect(result.name).toBe('EZ Prep');
    });

    it('rejects a second create', async () => {
      model.findById.mockReturnValue(chain(stored()));
      await expect(service.create({ name: 'EZ Prep' })).rejects.toThrow(
        ConflictException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate-key race to a conflict', async () => {
      model.findById.mockReturnValue(chain(null));
      model.create.mockRejectedValue({ code: 11000 });
      await expect(service.create({ name: 'ExamFlex' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows unexpected create errors', async () => {
      model.findById.mockReturnValue(chain(null));
      model.create.mockRejectedValue(new Error('down'));
      await expect(service.create({ name: 'ExamFlex' })).rejects.toThrow(
        'down',
      );
    });
  });

  describe('vectorSearch', () => {
    it('returns the NCERT defaults when nothing is stored', async () => {
      model.findById.mockReturnValue(chain(stored()));
      const result = await service.get();
      expect(result?.vectorSearch.collectionName).toBe('Ncert');
      expect(result?.vectorSearch.isDefault).toBe(true);
      expect(result?.vectorSearch.subjects.map(s => s.key)).toEqual([
        'maths',
        'biology',
        'chemistry',
        'physics',
      ]);
      expect(
        result?.vectorSearch.subjects.find(s => s.key === 'physics')
          ?.vectorSubjectId,
      ).toBe('6afd6aa47d65768788984fed');
    });

    it('returns stored values when present', async () => {
      model.findById.mockReturnValue(
        chain(
          stored({
            vectorSearch: {
              collectionName: 'NcertV2',
              subjects: [
                { key: 'physics', label: 'Physics', vectorSubjectId: 'p' },
              ],
            },
          }),
        ),
      );
      const result = await service.get();
      expect(result?.vectorSearch).toEqual({
        collectionName: 'NcertV2',
        subjects: [{ key: 'physics', label: 'Physics', vectorSubjectId: 'p' }],
        isDefault: false,
      });
    });

    it('sets the collection and replaces the subject list as a whole', async () => {
      model.findByIdAndUpdate.mockReturnValue(chain(stored()));
      await service.update({
        vectorSearch: {
          collectionName: 'Ncert',
          subjects: [
            { key: 'biology', label: 'Biology', vectorSubjectId: 'b' },
          ],
        },
      });
      expect(model.findByIdAndUpdate.mock.calls[0][1]).toEqual({
        $set: {
          'vectorSearch.collectionName': 'Ncert',
          'vectorSearch.subjects': [
            { key: 'biology', label: 'Biology', vectorSubjectId: 'b' },
          ],
        },
      });
    });

    it('rejects duplicate subject keys', async () => {
      await expect(
        service.update({
          vectorSearch: {
            subjects: [
              { key: 'biology', label: 'B', vectorSubjectId: 'b' },
              { key: 'biology', label: 'B2', vectorSubjectId: 'c' },
            ],
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('replaces only the fields that were sent', async () => {
      model.findByIdAndUpdate.mockReturnValue(
        chain(stored({ name: 'ExamFlex' })),
      );

      const result = await service.update({ name: 'ExamFlex' });

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        INSTANCE_CONFIG_ID,
        { $set: { name: 'ExamFlex' } },
        { new: true },
      );
      expect(result.name).toBe('ExamFlex');
    });

    it('clears a url when null is sent', async () => {
      model.findByIdAndUpdate.mockReturnValue(
        chain(stored({ logoUrl: undefined })),
      );

      const result = await service.update({ logoUrl: null });

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        INSTANCE_CONFIG_ID,
        { $unset: { logoUrl: 1 } },
        { new: true },
      );
      expect(result.logoUrl).toBeNull();
    });

    it('can set and clear urls in one update', async () => {
      model.findByIdAndUpdate.mockReturnValue(chain(stored()));
      await service.update({
        logoUrl: 'https://cdn.example.com/new.png',
        faviconUrl: null,
      });
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        INSTANCE_CONFIG_ID,
        {
          $set: { logoUrl: 'https://cdn.example.com/new.png' },
          $unset: { faviconUrl: 1 },
        },
        { new: true },
      );
    });

    it('rejects an empty update', async () => {
      await expect(service.update({})).rejects.toThrow(BadRequestException);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns not found when nothing has been created yet', async () => {
      model.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.update({ name: 'ExamFlex' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sets only the GSTIN that was sent', async () => {
      model.findByIdAndUpdate.mockReturnValue(
        chain(
          stored({
            seller: { legalName: 'Kept', gstin: '99NOTACHECKSUM' },
          }),
        ),
      );

      const result = await service.update({
        seller: { gstin: '99NOTACHECKSUM' },
      });

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        INSTANCE_CONFIG_ID,
        { $set: { 'seller.gstin': '99NOTACHECKSUM' } },
        { new: true },
      );
      expect(result.seller?.gstin).toBe('99NOTACHECKSUM');
      expect(result.seller?.legalName).toBe('Kept');
    });

    it('sets only the operations field that was sent', async () => {
      model.findByIdAndUpdate.mockReturnValue(
        chain(
          stored({
            operations: { reconciliationEnabled: true },
          }),
        ),
      );

      const result = await service.update({
        operations: { reconciliationEnabled: true },
      });

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        INSTANCE_CONFIG_ID,
        { $set: { 'operations.reconciliationEnabled': true } },
        { new: true },
      );
      expect(result.operations?.reconciliationEnabled).toBe(true);
      expect(result.operations?.invoicesEnabled).toBeNull();
      expect(result.redis).toBeNull();
    });
  });
});
