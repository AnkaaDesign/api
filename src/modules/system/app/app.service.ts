import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { AppRepository } from './repositories/app.repository';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly appRepository: AppRepository) {}

  async findById(id: string, include?: any) {
    const app = await this.appRepository.findById(id, { include });
    if (!app) {
      throw new NotFoundException(`App with ID "${id}" not found`);
    }

    return {
      success: true,
      message: 'App retrieved successfully',
      data: app,
    };
  }

  async findMany(params: any) {
    const { page = 1, limit = 50, ...filters } = params;
    const skip = (page - 1) * limit;

    const { data, total } = await this.appRepository.findMany({
      where: filters.where,
      include: filters.include,
      orderBy: filters.orderBy || { createdAt: 'desc' },
      skip,
      take: limit,
    });

    return {
      success: true,
      message: 'Apps retrieved successfully',
      data,
      meta: {
        totalRecords: total,
        page,
        limit,
        hasNextPage: skip + limit < total,
      },
    };
  }
}
