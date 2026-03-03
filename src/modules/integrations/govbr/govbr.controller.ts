import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { GovbrService } from './govbr.service';
import {
  SignDocumentRequestSchema,
  SignDocumentResponse,
  GetCertificateRequestSchema,
  GetCertificateResponse,
} from './dto/sign-document.dto';

@Controller('govbr')
export class GovbrController {
  constructor(private readonly govbrService: GovbrService) {}

  @Post('sign')
  @HttpCode(HttpStatus.OK)
  async signDocument(
    @Body() body: unknown,
  ): Promise<{ success: true; data: SignDocumentResponse }> {
    const parsed = SignDocumentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors);
    }

    const { code, hashBase64, environment } = parsed.data;
    const redirectUri = 'ankaadesign://govbr-callback';

    const result = await this.govbrService.exchangeAndSign(
      code,
      hashBase64,
      environment,
      redirectUri,
    );

    return { success: true, data: result };
  }

  @Post('certificate')
  @HttpCode(HttpStatus.OK)
  async getCertificate(
    @Body() body: unknown,
  ): Promise<{ success: true; data: GetCertificateResponse }> {
    const parsed = GetCertificateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors);
    }

    const { code, environment } = parsed.data;
    const redirectUri = 'ankaadesign://govbr-callback';

    const result = await this.govbrService.exchangeAndGetCertificate(
      code,
      environment,
      redirectUri,
    );

    return { success: true, data: result };
  }
}
