import { Transporter } from 'nodemailer';
import { MailerRepository, MailerResult } from './mailer.repository';
import * as nodemailer from 'nodemailer';

export class NodemailRepository implements MailerRepository {
  constructor(
    private transporter: Transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    }),
  ) {}

  async sendMail(to: string, subject: string, html: string): Promise<MailerResult> {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      return {
        messageId: result.messageId,
      };
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }
}
