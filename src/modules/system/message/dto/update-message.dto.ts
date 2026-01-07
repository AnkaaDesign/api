import { PartialType } from '@nestjs/swagger';
import { CreateMessageDto } from './create-message.dto';

/**
 * DTO for updating an existing message
 * All fields from CreateMessageDto are optional
 */
export class UpdateMessageDto extends PartialType(CreateMessageDto) {}
