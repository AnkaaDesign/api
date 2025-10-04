import { Module, Global } from '@nestjs/common';
import { EventEmitter } from 'events';

@Global()
@Module({
  providers: [
    {
      provide: 'EventEmitter',
      useValue: new EventEmitter(),
    },
  ],
  exports: ['EventEmitter'],
})
export class EventEmitterModule {}
