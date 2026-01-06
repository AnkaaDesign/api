import { IsString, IsNotEmpty, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'FCM device token',
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
    description: 'FCM device token',
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
