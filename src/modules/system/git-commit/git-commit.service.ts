import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { GitCommitRepository } from './repositories/git-commit.repository';

@Injectable()
export class GitCommitService {
  private readonly logger = new Logger(GitCommitService.name);

  constructor(private readonly gitCommitRepository: GitCommitRepository) {}

  async findById(id: string, include?: any) {
    const gitCommit = await this.gitCommitRepository.findById(id, { include });
    if (!gitCommit) {
      throw new NotFoundException(`GitCommit with ID "${id}" not found`);
    }

    return {
      success: true,
      message: 'Git commit retrieved successfully',
      data: gitCommit,
    };
  }

  async findMany(params: any) {
    const { page = 1, limit = 50, ...filters } = params;
    const skip = (page - 1) * limit;

    const { data, total } = await this.gitCommitRepository.findMany({
      where: filters.where,
      include: filters.include,
      orderBy: filters.orderBy || { committedAt: 'desc' },
      skip,
      take: limit,
    });

    return {
      success: true,
      message: 'Git commits retrieved successfully',
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
