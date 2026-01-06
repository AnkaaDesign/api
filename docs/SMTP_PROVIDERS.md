# SMTP Provider Quick Reference

A comprehensive guide to configuring popular SMTP providers for email sending.

## Comparison Table

| Provider | Free Tier | Reliability | Setup Difficulty | Best For |
|----------|-----------|-------------|------------------|----------|
| Gmail | 500/day | High | Easy | Development, Small apps |
| SendGrid | 100/day | Very High | Easy | Production apps |
| Mailgun | 5,000/month | Very High | Medium | Production apps |
| Amazon SES | 62,000/month* | Very High | Medium | Large scale apps |
| Outlook | 300/day | High | Easy | Development |
| Postmark | 100/month | Very High | Easy | Transactional emails |

*When sending from EC2

## Provider Details

### 1. Gmail (Google Workspace)

**Pros:**
- Free and easy to set up
- High reliability
- Good for development and testing
- No credit card required

**Cons:**
- Daily sending limits (500 for personal, 2,000 for Workspace)
- Requires App Password setup
- Not recommended for production at scale

**Configuration:**
```bash
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="xxxx xxxx xxxx xxxx"  # App Password
SMTP_FROM_EMAIL="your-email@gmail.com"
SMTP_FROM_NAME="Your Name"
```

**Setup Instructions:**
1. Enable 2-Factor Authentication: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Select "Mail" as the app and "Other" as the device
4. Copy the 16-character password and use it in `SMTP_PASSWORD`

**Sending Limits:**
- Personal Gmail: 500 recipients/day
- Google Workspace: 2,000 recipients/day
- Rate: Up to 100 recipients per message

**Use Cases:**
- Development and testing
- Small internal tools
- Low-volume notifications

---

### 2. SendGrid

**Pros:**
- Generous free tier (100 emails/day)
- Excellent deliverability
- Detailed analytics
- Great documentation

**Cons:**
- Requires email verification
- Free tier has SendGrid branding in footer
- Domain verification needed for better deliverability

**Configuration:**
```bash
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="apikey"  # Literally the word "apikey"
SMTP_PASSWORD="SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
SMTP_FROM_EMAIL="noreply@yourdomain.com"
SMTP_FROM_NAME="Your Company"
```

**Setup Instructions:**
1. Sign up at https://sendgrid.com
2. Verify your email address
3. Go to Settings > API Keys
4. Create new API Key with "Full Access" or "Mail Send" permission
5. Copy the API key (starts with "SG.")
6. Use "apikey" as username and the API key as password
7. Verify sender email or domain (Settings > Sender Authentication)

**Sending Limits:**
- Free: 100 emails/day forever
- Essentials ($19.95/mo): 50,000 emails/month
- Pro ($89.95/mo): 100,000 emails/month
- Can send up to 1,000 emails per API call

**Use Cases:**
- Production applications
- Marketing emails
- Transactional emails
- Applications requiring analytics

**Additional Features:**
- Email validation API
- Dedicated IP addresses (paid plans)
- Advanced analytics and reporting
- Template engine
- Webhook support

---

### 3. Mailgun

**Pros:**
- Generous free tier (5,000 emails/month)
- Excellent API documentation
- Good deliverability
- Detailed logging and analytics

**Cons:**
- Requires domain verification
- Free tier limited to authorized recipients
- Initial setup more complex than others

**Configuration:**
```bash
SMTP_HOST="smtp.mailgun.org"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="postmaster@your-domain.mailgun.org"
SMTP_PASSWORD="your-smtp-password"
SMTP_FROM_EMAIL="noreply@your-domain.com"
SMTP_FROM_NAME="Your Company"
```

**Setup Instructions:**
1. Sign up at https://www.mailgun.com
2. Add and verify your domain (Sending > Domains > Add New Domain)
3. Update DNS records (MX, TXT for SPF, TXT for DKIM)
4. Wait for domain verification (can take up to 48 hours)
5. Get SMTP credentials from domain settings
6. For sandbox domain (testing): Add authorized recipients

**Sending Limits:**
- Free Trial: 5,000 emails/month (first 3 months)
- Foundation ($35/mo): 50,000 emails/month
- Growth ($80/mo): 100,000 emails/month
- Pay-as-you-go: $0.80 per 1,000 emails

**Use Cases:**
- Production applications
- High-volume sending
- Applications requiring detailed logs
- Email validation needs

**Additional Features:**
- Email validation API
- Detailed logs (7 days free, longer with paid plans)
- Route and store incoming emails
- Advanced analytics

---

### 4. Amazon SES (Simple Email Service)

**Pros:**
- Very cost-effective ($0.10 per 1,000 emails)
- Highly scalable
- Excellent deliverability
- 62,000 free emails/month when sending from EC2

**Cons:**
- Starts in sandbox mode (limited to verified addresses)
- More complex setup
- Requires AWS account
- Need to request production access

**Configuration:**
```bash
SMTP_HOST="email-smtp.us-east-1.amazonaws.com"  # Change region
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="AKIAXXXXXXXXXXXXXXXX"  # SMTP username (not IAM key)
SMTP_PASSWORD="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
SMTP_FROM_EMAIL="noreply@verified-domain.com"
SMTP_FROM_NAME="Your Company"
```

**Setup Instructions:**
1. Create AWS account: https://aws.amazon.com
2. Go to Amazon SES Console
3. Verify email address or domain (Identity Management)
4. Create SMTP credentials (SMTP Settings > Create SMTP Credentials)
5. Note the SMTP endpoint for your region
6. Request production access (Account dashboard > Request production access)
7. Fill out sending quota increase form if needed

**Sending Limits:**
- Sandbox: 200 emails/day, 1 email/second
- Production: Starts at 50,000/day, can request increase
- Free tier: 62,000 emails/month when sending from EC2

**Regional Endpoints:**
- US East (N. Virginia): `email-smtp.us-east-1.amazonaws.com`
- US West (Oregon): `email-smtp.us-west-2.amazonaws.com`
- EU (Ireland): `email-smtp.eu-west-1.amazonaws.com`
- Asia Pacific (Singapore): `email-smtp.ap-southeast-1.amazonaws.com`

**Use Cases:**
- Large-scale applications
- AWS-hosted applications
- Cost-sensitive projects
- High-volume sending

**Additional Features:**
- Email receiving
- Dedicated IP addresses
- Reputation dashboard
- Bounce and complaint handling
- Integration with other AWS services

---

### 5. Microsoft Outlook / Office 365

**Pros:**
- Free for personal use
- Easy setup
- Good for development
- Reliable

**Cons:**
- Low sending limits
- Not suitable for production
- May require app password with 2FA

**Configuration:**
```bash
SMTP_HOST="smtp-mail.outlook.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-email@outlook.com"
SMTP_PASSWORD="your-password"
SMTP_FROM_EMAIL="your-email@outlook.com"
SMTP_FROM_NAME="Your Name"
```

**Setup Instructions:**
1. Create Outlook account if you don't have one
2. If using 2FA, generate app password:
   - Go to Security settings
   - Select "Create a new app password"
   - Use generated password in SMTP_PASSWORD

**Sending Limits:**
- Personal: 300 recipients/day
- Office 365 Business: 10,000 recipients/day
- Exchange Online: 10,000 recipients/day

**Use Cases:**
- Development and testing
- Small internal tools
- Personal projects

---

### 6. Postmark

**Pros:**
- Excellent deliverability
- Fast delivery (under 1 second)
- Great customer support
- Clean, simple interface

**Cons:**
- No free tier (only 100 emails trial)
- More expensive than alternatives
- Focused on transactional emails only

**Configuration:**
```bash
SMTP_HOST="smtp.postmarkapp.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-server-token"
SMTP_PASSWORD="your-server-token"  # Same as username
SMTP_FROM_EMAIL="noreply@verified-domain.com"
SMTP_FROM_NAME="Your Company"
```

**Setup Instructions:**
1. Sign up at https://postmarkapp.com
2. Verify sender signature (email or domain)
3. Get Server API Token from server settings
4. Use the same token for both username and password

**Pricing:**
- 100 emails/month free (trial)
- $10/mo: 10,000 emails
- $50/mo: 50,000 emails
- $0.0015 per additional email

**Use Cases:**
- Transactional emails (receipts, password resets, etc.)
- Applications requiring fast delivery
- Projects with budget for premium service

---

### 7. Brevo (formerly Sendinblue)

**Pros:**
- Generous free tier (300 emails/day)
- Good deliverability
- Marketing features included
- SMS capabilities

**Cons:**
- Branding on free tier
- UI can be overwhelming
- Setup slightly more complex

**Configuration:**
```bash
SMTP_HOST="smtp-relay.brevo.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-email@example.com"
SMTP_PASSWORD="your-smtp-key"
SMTP_FROM_EMAIL="noreply@yourdomain.com"
SMTP_FROM_NAME="Your Company"
```

**Sending Limits:**
- Free: 300 emails/day
- Lite ($25/mo): 10,000 emails/month
- Premium ($65/mo): 20,000 emails/month

**Use Cases:**
- Marketing and transactional emails
- Applications needing SMS
- Marketing automation

---

## Choosing the Right Provider

### For Development
- **Gmail** or **Outlook**: Easy setup, free, good for testing

### For Small Production Apps
- **SendGrid** (free tier): 100 emails/day
- **Mailgun** (trial): 5,000 emails/month
- **Brevo**: 300 emails/day

### For Medium-Scale Apps
- **SendGrid** (paid): Excellent deliverability and analytics
- **Mailgun** (paid): Good API, detailed logs
- **Postmark**: Best for transactional emails

### For Large-Scale Apps
- **Amazon SES**: Most cost-effective at scale
- **SendGrid** (high-volume): Proven at scale
- **Mailgun** (high-volume): Good for complex routing

### For E-commerce
- **Postmark**: Fast transactional emails
- **SendGrid**: Good analytics and templates

### For Marketing
- **Brevo**: Built-in marketing features
- **SendGrid**: Good for both transactional and marketing

## Security Best Practices

1. **Use App Passwords**: Never use your main account password
2. **Verify Domains**: Set up SPF, DKIM, and DMARC records
3. **Rotate Credentials**: Change passwords/API keys regularly
4. **Monitor Usage**: Watch for unusual sending patterns
5. **Use HTTPS**: Always use TLS/SSL for connections
6. **Separate Environments**: Different credentials for dev/staging/prod

## Deliverability Tips

1. **Verify Sender Domain**: Use authenticated domains
2. **Warm Up IP**: Gradually increase sending volume
3. **Monitor Bounces**: Handle bounce and complaint feedback
4. **List Hygiene**: Remove invalid addresses
5. **SPF/DKIM/DMARC**: Configure all three
6. **Reputation**: Maintain good sender reputation
7. **Content**: Avoid spam trigger words
8. **Engagement**: Send to engaged recipients

## Testing Recommendations

1. **Use Real Providers in Staging**: Don't use Gmail in production
2. **Test All Templates**: Verify rendering across email clients
3. **Monitor Deliverability**: Track open rates and bounces
4. **Load Testing**: Test at expected volume before launch
5. **Failover**: Have backup provider configured

## Support and Resources

### Gmail
- [Gmail SMTP setup](https://support.google.com/a/answer/176600)
- [App Passwords](https://support.google.com/accounts/answer/185833)

### SendGrid
- [Documentation](https://docs.sendgrid.com/)
- [Support](https://support.sendgrid.com/)

### Mailgun
- [Documentation](https://documentation.mailgun.com/)
- [Support](https://www.mailgun.com/support/)

### Amazon SES
- [Documentation](https://docs.aws.amazon.com/ses/)
- [Production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)

### Postmark
- [Documentation](https://postmarkapp.com/developer)
- [Support](https://postmarkapp.com/support)

### Brevo
- [Documentation](https://developers.brevo.com/)
- [Support](https://help.brevo.com/)
