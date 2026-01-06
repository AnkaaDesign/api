import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * DTO for sending WhatsApp messages
 */
export class SendMessageDto {
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString({ message: 'Phone number must be a string' })
  @Matches(/^\d{10,15}$/, {
    message:
      'Invalid phone number format. Use international format without + or spaces (e.g., 5511999999999)',
  })
  phone: string;

  @IsNotEmpty({ message: 'Message is required' })
  @IsString({ message: 'Message must be a string' })
  @MaxLength(4096, { message: 'Message must not exceed 4096 characters' })
  message: string;
}
