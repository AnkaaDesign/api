import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { RepositoryRepository } from './repositories/repository.repository';

@Injectable()
export class RepositoryService {
  private readonly logger = new Logger(RepositoryService.name);

  constructor(
    private readonly repositoryRepository: RepositoryRepository,
  ) {}

  async create(data: any, userId: string, include?: any) {
    try {
      // Validate
      if (!data.name) {
        throw new BadRequestException('Repository name is required');
      }
      if (!data.gitUrl) {
        throw new BadRequestException('Git URL is required');
      }

      // Check if name already exists
      const existing = await this.repositoryRepository.findByName(data.name);
      if (existing) {
        throw new BadRequestException(`Repository with name "${data.name}" already exists`);
      }

      // Create
      const repository = await this.repositoryRepository.create(data, { include });

      return {
        success: true,
        message: 'Repository created successfully',
        data: repository,
      };
    } catch (error) {
      this.logger.error(`Error creating repository: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findById(id: string, include?: any) {
    const repository = await this.repositoryRepository.findById(id, { include });
    if (!repository) {
      throw new NotFoundException(`Repository with ID "${id}" not found`);
    }

    return {
      success: true,
      message: 'Repository retrieved successfully',
      data: repository,
    };
  }

  async findMany(params: any) {
    const { page = 1, limit = 40, ...filters } = params;
    const skip = (page - 1) * limit;

    const { data, total } = await this.repositoryRepository.findMany({
      where: filters.where,
      include: filters.include,
      orderBy: filters.orderBy || { createdAt: 'desc' },
      skip,
      take: limit,
    });

    return {
      success: true,
      message: 'Repositories retrieved successfully',
      data,
      meta: {
        totalRecords: total,
        page,
        limit,
        hasNextPage: skip + limit < total,
      },
    };
  }

  async update(id: string, data: any, userId: string, include?: any) {
    try {
      // Check exists
      await this.findById(id);

      // Update
      const repository = await this.repositoryRepository.update(id, data, { include });

      return {
        success: true,
        message: 'Repository updated successfully',
        data: repository,
      };
    } catch (error) {
      this.logger.error(`Error updating repository: ${error.message}`, error.stack);
      throw error;
    }
  }

  async delete(id: string, userId: string) {
    try {
      // Check exists
      await this.findById(id);

      // Delete
      const repository = await this.repositoryRepository.delete(id);

      return {
        success: true,
        message: 'Repository deleted successfully',
        data: repository,
      };
    } catch (error) {
      this.logger.error(`Error deleting repository: ${error.message}`, error.stack);
      throw error;
    }
  }
}
