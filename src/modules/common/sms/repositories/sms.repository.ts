export abstract class SmsRepository {
  abstract sendSms(to: string, message: string): Promise<void>;
}
