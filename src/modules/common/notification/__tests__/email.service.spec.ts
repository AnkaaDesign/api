import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from '../mailer/mailer.service';
import { ConfigService } from '@nestjs/config';
import { DeepLinkService } from '../deep-link.service';
import { NOTIFICATION_TYPE } from '../../../../constants';

describe('MailerService', () => {
  let service: MailerService;
  let configService: ConfigService;
  let deepLinkService: DeepLinkService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: any = {
        SMTP_HOST: 'smtp.test.com',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: 'test@example.com',
        SMTP_PASS: 'password',
        EMAIL_FROM: 'noreply@example.com',
        COMPANY_NAME: 'Test Company',
        SUPPORT_EMAIL: 'support@example.com',
        API_URL: 'http://localhost:3030',
        WEB_APP_URL: 'http://localhost:3000',
      };
      return config[key];
    }),
  };

  const mockDeepLinkService = {
    generateBothLinks: jest.fn((entityType, entityId, queryParams) => ({
      web: `http://localhost:3000/${entityType}/${entityId}`,
      mobile: `app://${entityType}/${entityId}`,
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DeepLinkService, useValue: mockDeepLinkService },
      ],
    }).compile();

    service = module.get<MailerService>(MailerService);
    configService = module.get<ConfigService>(ConfigService);
    deepLinkService = module.get<DeepLinkService>(DeepLinkService);

    // Mock transporter to avoid actual SMTP connections
    (service as any).transporter = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
      verify: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Email',
        html: '<p>Test HTML content</p>',
        text: 'Test text content',
      };

      const result = await service.sendEmail(options);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(result.recipient).toBe('test@example.com');
    });

    it('should generate plain text from HTML when not provided', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Email',
        html: '<p>Test <strong>HTML</strong> content</p>',
      };

      await service.sendEmail(options);

      const transporter = (service as any).transporter;
      expect(transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.any(String),
        }),
      );
    });

    it('should validate email address', async () => {
      const options = {
        to: 'invalid-email',
        subject: 'Test',
        html: '<p>Test</p>',
      };

      const result = await service.sendEmail(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid email');
    });

    it('should render template when specified', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test',
        template: 'task-created',
        templateData: {
          taskTitle: 'Test Task',
          taskId: '123',
        },
      };

      // Mock template loading
      jest
        .spyOn(service as any, 'loadTemplate')
        .mockResolvedValue(jest.fn(() => '<html><body>Task: {{taskTitle}}</body></html>'));

      const result = await service.sendEmail(options);

      expect(result.success).toBe(true);
    });

    it('should require either HTML or text content', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test',
      };

      const result = await service.sendEmail(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('must have either HTML or text');
    });

    it('should retry on transient errors', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      };

      const transporter = (service as any).transporter;
      transporter.sendMail
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ messageId: 'msg-123' });

      const result = await service.sendEmail(options);

      expect(result.success).toBe(true);
      expect(transporter.sendMail).toHaveBeenCalledTimes(2);
    });

    it('should not retry on permanent errors', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      };

      const transporter = (service as any).transporter;
      transporter.sendMail.mockRejectedValue(new Error('Invalid recipient'));

      const result = await service.sendEmail(options);

      expect(result.success).toBe(false);
      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendBulkEmails', () => {
    it('should send emails to multiple recipients', async () => {
      const recipients = [
        { email: 'user1@example.com', templateData: { name: 'User 1' } },
        { email: 'user2@example.com', templateData: { name: 'User 2' } },
        { email: 'user3@example.com', templateData: { name: 'User 3' } },
      ];

      jest
        .spyOn(service as any, 'loadTemplate')
        .mockResolvedValue(jest.fn(() => '<html><body>Hello {{name}}</body></html>'));

      const result = await service.sendBulkEmails(
        recipients,
        'Test Subject',
        'generic-notification',
      );

      expect(result.totalSent).toBe(3);
      expect(result.totalFailed).toBe(0);
    });

    it('should handle partial failures in bulk send', async () => {
      const recipients = [
        { email: 'valid@example.com', templateData: { name: 'Valid' } },
        { email: 'invalid-email', templateData: { name: 'Invalid' } },
      ];

      jest
        .spyOn(service as any, 'loadTemplate')
        .mockResolvedValue(jest.fn(() => '<html><body>Hello {{name}}</body></html>'));

      const result = await service.sendBulkEmails(
        recipients,
        'Test Subject',
        'generic-notification',
      );

      expect(result.totalSent).toBe(1);
      expect(result.totalFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should process emails in batches', async () => {
      const recipients = Array.from({ length: 60 }, (_, i) => ({
        email: `user${i}@example.com`,
        templateData: { name: `User ${i}` },
      }));

      jest
        .spyOn(service as any, 'loadTemplate')
        .mockResolvedValue(jest.fn(() => '<html><body>Hello {{name}}</body></html>'));

      const result = await service.sendBulkEmails(
        recipients,
        'Test Subject',
        'generic-notification',
      );

      expect(result.totalSent).toBe(60);
      // Should be processed in multiple batches (batch size = 50)
    });
  });

  describe('validateEmail', () => {
    it('should validate correct email format', () => {
      const validEmails = [
        'test@example.com',
        'user.name@example.co.uk',
        'first+last@example.com',
        '123@test.com',
      ];

      validEmails.forEach(email => {
        const result = service.validateEmail(email);
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'invalid',
        '@example.com',
        'test@',
        'test @example.com',
        'test..name@example.com',
      ];

      invalidEmails.forEach(email => {
        const result = service.validateEmail(email);
        expect(result.isValid).toBe(false);
      });
    });

    it('should reject empty or null emails', () => {
      const result1 = service.validateEmail('');
      const result2 = service.validateEmail(null as any);

      expect(result1.isValid).toBe(false);
      expect(result2.isValid).toBe(false);
    });

    it('should reject too long emails', () => {
      const longEmail = 'a'.repeat(300) + '@example.com';
      const result = service.validateEmail(longEmail);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should reject emails with hard bounces', () => {
      const bouncedEmail = 'bounced@example.com';

      // Simulate a hard bounce
      service.handleBounces({
        email: bouncedEmail,
        bounceType: 'hard',
        reason: 'Mailbox does not exist',
        timestamp: new Date(),
      });

      const result = service.validateEmail(bouncedEmail);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('hard bounce');
    });
  });

  describe('attachDeepLink', () => {
    it('should attach deep link to email', () => {
      const html = '<html><body>Test content</body></html>';
      const result = service.attachDeepLink(html, 'task' as any, 'task-123', 'View Task');

      expect(result).toContain('http://localhost:3000/task/task-123');
      expect(result).toContain('View Task');
      expect(deepLinkService.generateBothLinks).toHaveBeenCalledWith('task', 'task-123', undefined);
    });

    it('should include query parameters in deep link', () => {
      const html = '<html><body>Test content</body></html>';
      const queryParams = { source: 'email', campaign: 'test' };

      service.attachDeepLink(html, 'task' as any, 'task-123', 'View Task', queryParams);

      expect(deepLinkService.generateBothLinks).toHaveBeenCalledWith(
        'task',
        'task-123',
        queryParams,
      );
    });
  });

  describe('trackEmailOpened', () => {
    it('should add tracking pixel to email', () => {
      const html = '<html><body>Test content</body></html>';
      const trackingData = {
        notificationId: 'notif-123',
        userId: 'user-123',
      };

      const result = service.trackEmailOpened(html, trackingData);

      expect(result).toContain('track/email-open');
      expect(result).toContain('img');
      expect(result).toContain('width="1"');
      expect(result).toContain('height="1"');
    });
  });

  describe('trackLinkClicked', () => {
    it('should wrap links with tracking', () => {
      const html = '<html><body><a href="https://example.com">Click here</a></body></html>';
      const trackingData = {
        notificationId: 'notif-123',
        userId: 'user-123',
      };

      const result = service.trackLinkClicked(html, trackingData);

      expect(result).toContain('track/email-click');
    });

    it('should not track mailto links', () => {
      const html = '<html><body><a href="mailto:test@example.com">Email</a></body></html>';
      const trackingData = { notificationId: 'notif-123' };

      const result = service.trackLinkClicked(html, trackingData);

      expect(result).not.toContain('track/email-click');
      expect(result).toContain('mailto:test@example.com');
    });

    it('should not track unsubscribe links', () => {
      const html = '<html><body><a href="/unsubscribe">Unsubscribe</a></body></html>';
      const trackingData = { notificationId: 'notif-123' };

      const result = service.trackLinkClicked(html, trackingData);

      expect(result).not.toContain('track/email-click');
    });
  });

  describe('handleBounces', () => {
    it('should store bounce data for hard bounces', async () => {
      const bounceData = {
        email: 'test@example.com',
        bounceType: 'hard' as const,
        reason: 'Mailbox does not exist',
        timestamp: new Date(),
      };

      await service.handleBounces(bounceData);

      const bounce = service.getBounceData('test@example.com');
      expect(bounce).toBeDefined();
      expect(bounce?.bounceType).toBe('hard');
    });

    it('should store bounce data for soft bounces', async () => {
      const bounceData = {
        email: 'test@example.com',
        bounceType: 'soft' as const,
        reason: 'Mailbox full',
        timestamp: new Date(),
      };

      await service.handleBounces(bounceData);

      const bounce = service.getBounceData('test@example.com');
      expect(bounce).toBeDefined();
      expect(bounce?.bounceType).toBe('soft');
    });

    it('should store bounce data for spam complaints', async () => {
      const bounceData = {
        email: 'test@example.com',
        bounceType: 'complaint' as const,
        reason: 'Marked as spam',
        timestamp: new Date(),
      };

      await service.handleBounces(bounceData);

      const bounce = service.getBounceData('test@example.com');
      expect(bounce).toBeDefined();
      expect(bounce?.bounceType).toBe('complaint');
    });
  });

  describe('getBounceStatistics', () => {
    it('should return bounce statistics', async () => {
      await service.handleBounces({
        email: 'hard1@example.com',
        bounceType: 'hard',
        reason: 'Does not exist',
        timestamp: new Date(),
      });

      await service.handleBounces({
        email: 'soft1@example.com',
        bounceType: 'soft',
        reason: 'Mailbox full',
        timestamp: new Date(),
      });

      await service.handleBounces({
        email: 'complaint1@example.com',
        bounceType: 'complaint',
        reason: 'Spam',
        timestamp: new Date(),
      });

      const stats = service.getBounceStatistics();

      expect(stats.totalBounces).toBe(3);
      expect(stats.hardBounces).toBe(1);
      expect(stats.softBounces).toBe(1);
      expect(stats.complaints).toBe(1);
    });
  });

  describe('addUnsubscribeLink', () => {
    it('should add unsubscribe link to email', () => {
      const html = '<html><body>Test content</body></html>';
      const result = service.addUnsubscribeLink(html, 'user-123', 'TASK');

      expect(result).toContain('unsubscribe');
      expect(result).toContain('userId=user-123');
      expect(result).toContain('type=TASK');
    });

    it('should handle unsubscribe from all notifications', () => {
      const html = '<html><body>Test content</body></html>';
      const result = service.addUnsubscribeLink(html, 'user-123');

      expect(result).toContain('type=all');
    });
  });

  describe('healthCheck', () => {
    it('should return true when SMTP is healthy', async () => {
      const result = await service.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when SMTP connection fails', async () => {
      const transporter = (service as any).transporter;
      transporter.verify.mockRejectedValue(new Error('Connection failed'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('buildEmailFromTemplate', () => {
    it('should build email from template with data', async () => {
      const templateData = {
        userName: 'John Doe',
        taskTitle: 'Complete Report',
        taskId: '123',
      };

      // Mock template
      jest
        .spyOn(service as any, 'loadTemplate')
        .mockResolvedValue(
          jest.fn(
            (data: any) =>
              `<html><body>Hello ${data.userName}, Task: ${data.taskTitle}</body></html>`,
          ),
        );

      const result = await service.buildEmailFromTemplate('task-created', templateData);

      expect(result.html).toContain('John Doe');
      expect(result.html).toContain('Complete Report');
      expect(result.text).toBeTruthy();
    });

    it('should include company info in template data', async () => {
      jest
        .spyOn(service as any, 'loadTemplate')
        .mockResolvedValue(
          jest.fn(
            (data: any) =>
              `<html><body>Company: ${data.companyName}, Year: ${data.currentYear}</body></html>`,
          ),
        );

      const result = await service.buildEmailFromTemplate('generic-notification', {});

      expect(result.html).toContain('Test Company');
      expect(result.html).toContain(new Date().getFullYear().toString());
    });
  });

  describe('Error Categorization', () => {
    it('should categorize SMTP errors correctly', async () => {
      const errors = [
        { error: new Error('Invalid recipient'), expectedCode: 'INVALID_RECIPIENT' },
        { error: new Error('Mailbox full'), expectedCode: 'MAILBOX_FULL' },
        { error: new Error('ETIMEDOUT'), expectedCode: 'TIMEOUT' },
        { error: new Error('Connection refused'), expectedCode: 'CONNECTION_ERROR' },
        { error: new Error('Authentication failed'), expectedCode: 'AUTH_ERROR' },
        { error: new Error('Rate limit exceeded'), expectedCode: 'RATE_LIMIT' },
        { error: new Error('Unknown error'), expectedCode: 'UNKNOWN_ERROR' },
      ];

      const transporter = (service as any).transporter;

      for (const { error, expectedCode } of errors) {
        transporter.sendMail.mockRejectedValueOnce(error);

        const result = await service.sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        });

        expect(result.errorCode).toBe(expectedCode);
      }
    });
  });
});
