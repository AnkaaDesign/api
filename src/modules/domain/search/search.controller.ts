import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { User, UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ZodQueryValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { globalSearchSchema, GlobalSearchFormData } from '../../../schemas/search';
import { GlobalSearchResponse } from '../../../types';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Global spotlight search. Open to every authenticated privilege — the
   * service decides which entities each role may search (mirroring the web
   * detail-page access rules).
   */
  @Get()
  @Roles(...Object.values(SECTOR_PRIVILEGES))
  async search(
    @Query(new ZodQueryValidationPipe(globalSearchSchema)) query: GlobalSearchFormData,
    @User() user: UserPayload,
  ): Promise<GlobalSearchResponse> {
    return this.searchService.search(query, user);
  }
}
