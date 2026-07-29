import { IsString, IsNotEmpty, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'FCM registration token',
    example: 'cXQx...:APA91bGKPy...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: 'Device platform',
    enum: ['IOS', 'ANDROID', 'WEB'],
    example: 'ANDROID',
  })
  @IsEnum(['IOS', 'ANDROID', 'WEB'])
  @IsNotEmpty()
  platform: 'IOS' | 'ANDROID' | 'WEB';

  @ApiPropertyOptional({
    description:
      'Stable per-install identifier. When supplied, registering a new token retires the ' +
      'previous token of the same install immediately instead of waiting for it to go stale.',
    example: '6f6c1f3a-6d1e-4a2a-9f2f-6a0f0f0b1c22',
  })
  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class UnregisterDeviceTokenDto {
  @ApiProperty({
    description: 'FCM device token to unregister',
    example: 'cXQx...:APA91bGKPy...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class SendTestNotificationDto {
  @ApiProperty({
    description: 'FCM registration token',
    example: 'cXQx...:APA91bGKPy...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: 'Notification title',
    example: 'Test Notification',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Notification body/message',
    example: 'This is a test push notification',
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    description: 'Additional data payload',
    example: { orderId: '123', type: 'order_update' },
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}
