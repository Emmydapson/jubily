import { Test, TestingModule } from '@nestjs/testing';
import { PublishingController } from './publishing.controller';

describe('PublishingController', () => {
  let controller: PublishingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublishingController],
    }).compile();

    controller = module.get<PublishingController>(PublishingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
