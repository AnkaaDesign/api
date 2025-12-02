import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import simpleGit, { SimpleGit, LogResult, PullResult } from 'simple-git';
import * as path from 'path';

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: Date;
  message: string;
  body: string;
  branch?: string;
}

export interface GitPullResultInfo {
  success: boolean;
  summary: {
    changes: number;
    insertions: number;
    deletions: number;
  };
  files: string[];
  fromCommit: string;
  toCommit: string;
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly git: SimpleGit;
  private readonly repoPath: string;

  constructor() {
    // When running from apps/api, go up two directories to get to the monorepo root
    const cwd = process.cwd();
    this.repoPath = cwd.includes('apps/api') ? path.resolve(cwd, '../..') : path.resolve(cwd);
    this.git = simpleGit(this.repoPath);
    this.logger.log(`Git initialized at: ${this.repoPath}`);
  }

  /**
   * Get latest commits from the repository
   */
  async getLatestCommits(limit: number = 50): Promise<GitCommitInfo[]> {
    try {
      const log: LogResult = await this.git.log({
        maxCount: limit,
        '--branches': null,
      });

      return log.all.map(commit => ({
        hash: commit.hash,
        shortHash: commit.hash.substring(0, 7),
        author: commit.author_name,
        email: commit.author_email,
        date: new Date(commit.date),
        message: commit.message,
        body: commit.body || '',
      }));
    } catch (error) {
      this.logger.error(`Error fetching commits: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar commits do Git');
    }
  }

  /**
   * Get details of a specific commit
   */
  async getCommitDetails(hash: string): Promise<GitCommitInfo> {
    try {
      this.logger.log(`Fetching commit details for ${hash} from ${this.repoPath}`);

      // Use specific commit hash with -n 1 to get single commit details
      const log: LogResult = await this.git.log(['-n', '1', hash]);

      this.logger.log(
        `Git log result: ${JSON.stringify({ total: log.total, latest: !!log.latest })}`,
      );

      if (!log.latest) {
        throw new Error(`Commit ${hash} not found`);
      }

      const commit = log.latest;
      const branch = await this.getBranchForCommit(hash);

      return {
        hash: commit.hash,
        shortHash: commit.hash.substring(0, 7),
        author: commit.author_name,
        email: commit.author_email,
        date: new Date(commit.date),
        message: commit.message,
        body: commit.body || '',
        branch,
      };
    } catch (error) {
      this.logger.error(`Error fetching commit ${hash}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Erro ao buscar commit ${hash}`);
    }
  }

  /**
   * Pull latest code from remote
   */
  async pullLatestCode(branch: string = 'main'): Promise<GitPullResultInfo> {
    try {
      const beforePull = await this.getCurrentCommitHash();

      // Fetch all branches
      await this.git.fetch(['--all']);

      // Pull from origin
      const pullResult: PullResult = await this.git.pull('origin', branch, {
        '--rebase': 'false',
      });

      const afterPull = await this.getCurrentCommitHash();

      return {
        success: true,
        summary: {
          changes: pullResult.summary.changes,
          insertions: pullResult.summary.insertions,
          deletions: pullResult.summary.deletions,
        },
        files: pullResult.files,
        fromCommit: beforePull,
        toCommit: afterPull,
      };
    } catch (error) {
      this.logger.error(`Error pulling code: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao atualizar código do Git');
    }
  }

  /**
   * Get current commit hash
   */
  async getCurrentCommitHash(): Promise<string> {
    try {
      const result = await this.git.revparse(['HEAD']);
      return result.trim();
    } catch (error) {
      this.logger.error(`Error getting current commit: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar commit atual');
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const result = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return result.trim();
    } catch (error) {
      this.logger.error(`Error getting current branch: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar branch atual');
    }
  }

  /**
   * Get commits between two hashes
   */
  async getCommitsBetween(from: string, to: string): Promise<GitCommitInfo[]> {
    try {
      const log: LogResult = await this.git.log({
        from,
        to,
      });

      return log.all.map(commit => ({
        hash: commit.hash,
        shortHash: commit.hash.substring(0, 7),
        author: commit.author_name,
        email: commit.author_email,
        date: new Date(commit.date),
        message: commit.message,
        body: commit.body || '',
      }));
    } catch (error) {
      this.logger.error(
        `Error getting commits between ${from} and ${to}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Erro ao buscar histórico de commits');
    }
  }

  /**
   * Check if repository has uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const status = await this.git.status();
      return !status.isClean();
    } catch (error) {
      this.logger.error(`Error checking git status: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao verificar status do Git');
    }
  }

  /**
   * Get the branch for a specific commit
   */
  private async getBranchForCommit(hash: string): Promise<string | undefined> {
    try {
      const result = await this.git.raw([
        'branch',
        '--contains',
        hash,
        '--format=%(refname:short)',
      ]);

      const branches = result.trim().split('\n').filter(Boolean);
      return branches[0] || undefined;
    } catch (error) {
      this.logger.warn(`Could not determine branch for commit ${hash}: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Verify if a commit exists
   */
  async commitExists(hash: string): Promise<boolean> {
    try {
      await this.git.catFile(['-t', hash]);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get commit author information
   */
  async getCommitAuthor(hash: string): Promise<{ name: string; email: string }> {
    try {
      const name = await this.git.show(['-s', '--format=%an', hash]);
      const email = await this.git.show(['-s', '--format=%ae', hash]);

      return {
        name: name.trim(),
        email: email.trim(),
      };
    } catch (error) {
      this.logger.error(`Error getting commit author: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar autor do commit');
    }
  }

  /**
   * Get files changed in a commit
   */
  async getCommitFiles(hash: string): Promise<string[]> {
    try {
      const result = await this.git.show(['--pretty=', '--name-only', hash]);
      return result.trim().split('\n').filter(Boolean);
    } catch (error) {
      this.logger.error(`Error getting commit files: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erro ao buscar arquivos do commit');
    }
  }
}
