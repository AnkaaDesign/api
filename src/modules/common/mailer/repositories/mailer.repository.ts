export interface MailerResult {
  messageId?: string;
}

export abstract class MailerRepository {
  abstract sendMail(to: string, subject: string, html: string): Promise<MailerResult>;
}
