import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { PreferencesRepository } from './repositories/preferences.repository';
import { PreferencesPrismaRepository } from './repositories/preferences-prisma.repository';
import { NotificationPreferenceRepository } from './repositories/notification-preference/notification-preference.repository';
import { NotificationPreferencePrismaRepository } from './repositories/notification-preference/notification-preference-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [PreferencesController],
  providers: [
    PreferencesService,
    NotificationPreferenceService,
    {
      provide: PreferencesRepository,
      useClass: PreferencesPrismaRepository,
    },
    {
      provide: NotificationPreferenceRepository,
      useClass: NotificationPreferencePrismaRepository,
    },
  ],
  exports: [PreferencesService, NotificationPreferenceService],
})
export class PreferencesModule {}
