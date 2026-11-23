import { Test, TestingModule } from '@nestjs/testing';
import { FullMockTestsController } from './full-mock-tests.controller';
import { FullMockTestsService } from './full-mock-tests.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

describe('FullMockTestsController', () => {
  let controller: FullMockTestsController;
  const service = {
    listExamsForAdmin: jest.fn(),
    createDraft: jest.fn(),
    listDrafts: jest.fn(),
    searchQuestions: jest.fn(),
    getDraft: jest.fn(),
    replaceQuestion: jest.fn(),
    publishDraft: jest.fn(),
    discardDraft: jest.fn(),
    listPublished: jest.fn(),
    findOnePublished: jest.fn(),
    updateCourseCutoffs: jest.fn(),
  };
  const admin = { id: 'a1', role: UserRole.ADMIN };
  const student = { id: 's1', role: UserRole.USER };
  const page = { data: [{ id: '1' }], pagination: { total: 1 } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FullMockTestsController],
      providers: [{ provide: FullMockTestsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FullMockTestsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate admin and student endpoints', async () => {
    service.listExamsForAdmin.mockResolvedValue(page);
    service.createDraft.mockResolvedValue({ id: 'd1' });
    service.listDrafts.mockResolvedValue(page);
    service.searchQuestions.mockResolvedValue(page);
    service.getDraft.mockResolvedValue({ id: 'd1' });
    service.replaceQuestion.mockResolvedValue({ id: 'd1' });
    service.publishDraft.mockResolvedValue({ mockTestId: 't1' });
    service.discardDraft.mockResolvedValue(undefined);
    service.listPublished.mockResolvedValue(page);
    service.findOnePublished.mockResolvedValue({ id: 't1' });

    await expect(controller.listExams(1, 10, 'cgl')).resolves.toMatchObject({
      data: page.data,
    });
    await expect(
      controller.createDraft({ examId: 'e1' }, admin as any),
    ).resolves.toMatchObject({ data: { id: 'd1' } });
    await expect(controller.listDrafts('e1', 1, 10)).resolves.toMatchObject({
      data: page.data,
    });
    expect(service.listDrafts).toHaveBeenCalledWith('e1', 1, 10);
    await expect(
      controller.searchQuestions('s1', 'd1', 'q', 't', 'easy', 1, 20, true),
    ).resolves.toMatchObject({ data: page.data });
    expect(service.searchQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 's1',
        draftId: 'd1',
        allowCrossSubject: true,
      }),
    );
    await expect(controller.getDraft('d1')).resolves.toMatchObject({
      data: { id: 'd1' },
    });
    await expect(
      controller.replaceQuestion(
        'd1',
        0,
        {
          questionId: 'q1',
          allowCrossSubject: true,
        },
        admin as any,
      ),
    ).resolves.toMatchObject({ data: { id: 'd1' } });
    expect(service.replaceQuestion).toHaveBeenCalledWith(
      'd1',
      0,
      'q1',
      true,
      'a1',
    );
    await expect(
      controller.publishDraft('d1', { title: 'P' }, admin as any),
    ).resolves.toMatchObject({ data: { mockTestId: 't1' } });
    await expect(controller.discardDraft('d1', admin as any)).resolves.toEqual({
      message: 'Draft discarded successfully',
    });
    await expect(
      controller.listPublished('e1', 1, 10, admin as any),
    ).resolves.toMatchObject({ data: page.data });
    expect(service.listPublished).toHaveBeenCalledWith('e1', 1, 10, 'a1', true);
    await expect(controller.findOne('t1', admin as any)).resolves.toMatchObject(
      { data: { id: 't1' } },
    );
    expect(service.findOnePublished).toHaveBeenCalledWith('t1', 'a1', true);
  });

  it('loads published detail without questions for non-admins', async () => {
    service.findOnePublished.mockResolvedValue({ id: 't1' });
    await expect(
      controller.findOne('t1', student as any),
    ).resolves.toMatchObject({ data: { id: 't1' } });
    expect(service.findOnePublished).toHaveBeenCalledWith('t1', 's1', false);
  });

  it('delegates course cut-off edits to the service with the acting admin', async () => {
    const dto = {
      courseCutoffs: [
        { offeringId: 'o1', cutoffMarks: 620 },
        { offeringId: 'o2', cutoffMarks: null },
      ],
    };
    service.updateCourseCutoffs.mockResolvedValue({
      id: 't1',
      courseCutoffs: [{ offeringId: 'o1', cutoffMarks: 620 }],
    });

    await expect(
      controller.updateCourseCutoffs('t1', dto as any, admin as any),
    ).resolves.toEqual({
      message: 'Course cut-offs updated successfully',
      data: {
        id: 't1',
        courseCutoffs: [{ offeringId: 'o1', cutoffMarks: 620 }],
      },
    });
    expect(service.updateCourseCutoffs).toHaveBeenCalledWith('t1', dto, 'a1');
  });

  it('protects the cut-off route with the admin role', () => {
    const roles = Reflect.getMetadata(
      'roles',
      FullMockTestsController.prototype.updateCourseCutoffs,
    );
    expect(roles).toEqual([UserRole.ADMIN]);
  });
});
