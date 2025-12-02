# Logging Configuration Guide

## Quick Reference

### Log Levels (in order of verbosity)
1. `error` - Only errors and critical issues
2. `warn` - Warnings and errors
3. `info` - General information, warnings, and errors
4. `debug` - Debug information and above (default for development)
5. `verbose` - Very detailed output

### Environment Variables

```bash
# Logging
LOG_LEVEL="debug"              # Current log level
LOG_DIR="./logs"               # Directory for log files
LOG_FORMAT="json"              # json or simple
ENABLE_CONSOLE_LOGS="true"     # Enable console output
ENABLE_FILE_LOGS="false"       # Enable file logging
```

---

## Log Output Locations

### Development
- **Console:** Enabled by default
- **Files:** Disabled by default
- **Format:** Pretty-printed with colors

### Production
- **Console:** Should be disabled
- **Files:** Enabled with rotation
- **Format:** JSON for parsing

---

## Log File Structure

When file logging is enabled:

```
logs/
├── application-2025-11-30.log    # Daily rotated logs
├── application-2025-11-29.log
├── application-2025-11-28.log.gz # Compressed after rotation
├── error-2025-11-30.log          # Error-only logs
├── error-2025-11-29.log
└── error-2025-11-28.log.gz
```

### Rotation Policy
- **Application Logs:** 14 days retention, 20MB max size
- **Error Logs:** 30 days retention, 20MB max size
- **Compression:** Automatic after rotation

---

## Log Format Examples

### Development (Pretty Print)
```
2025-11-30 14:34:42 [INFO] [{"module":"FileUpload"}]: File accepted: document.pdf (application/pdf)
2025-11-30 14:34:43 [ERROR] [{"module":"Database"}]: Database query failed {"query":"SELECT * FROM users"}
```

### Production (JSON)
```json
{
  "timestamp": "2025-11-30 14:34:42",
  "level": "info",
  "message": "File accepted: document.pdf (application/pdf)",
  "context": {
    "module": "FileUpload",
    "requestId": "req_1732976082719_a3b2c1d",
    "userId": "user_123"
  }
}
```

---

## Using the Logger

### Basic Logging

```typescript
import { LoggerService } from '@common/services/logger.service';

export class YourService {
  constructor(private readonly logger: LoggerService) {}

  yourMethod() {
    // Log levels
    this.logger.error('Critical error occurred', stackTrace, { module: 'YourService' });
    this.logger.warn('Warning message', { module: 'YourService' });
    this.logger.info('Info message', { module: 'YourService' });
    this.logger.debug('Debug message', { module: 'YourService' });
    this.logger.verbose('Verbose message', { module: 'YourService' });
  }
}
```

### With Request Context

```typescript
import { LoggerService } from '@common/services/logger.service';

@Controller('users')
export class UserController {
  constructor(private readonly logger: LoggerService) {}

  @Get(':id')
  async getUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.logger.info('Fetching user', {
      module: 'UserController',
      userId: req.user?.id,
      requestId: req.id,
      targetUserId: id
    });

    try {
      const user = await this.userService.findOne(id);
      return user;
    } catch (error) {
      this.logger.error('Failed to fetch user', error.stack, {
        module: 'UserController',
        userId: req.user?.id,
        targetUserId: id
      });
      throw error;
    }
  }
}
```

### Child Logger (with persistent context)

```typescript
export class UserService {
  private readonly logger: LoggerService;

  constructor(baseLogger: LoggerService) {
    // Create child logger with persistent context
    this.logger = baseLogger.child({
      module: 'UserService',
      component: 'Authentication'
    });
  }

  login(email: string) {
    // All logs will include module and component context
    this.logger.info('User login attempt', { email });
    // Output includes: module: "UserService", component: "Authentication"
  }
}
```

### HTTP Request Logging

```typescript
// Automatically handled by LoggerService
logHttpRequest(req: AuthenticatedRequest, res: Response, responseTime: number) {
  // Logs include:
  // - requestId
  // - userId
  // - method
  // - url
  // - ip
  // - userAgent
  // - statusCode
  // - responseTime
}
```

### Database Query Logging

```typescript
logDatabaseQuery(query: string, params: any[], duration: number, error?: Error) {
  // Automatically logs:
  // - Successful queries at debug level
  // - Slow queries (>1s) at warn level
  // - Failed queries at error level
}
```

---

## Sensitive Data Protection

The logger automatically redacts sensitive information:

### Automatically Redacted Fields
- `password`
- `senha`
- `token`
- `authorization`
- `credit_card`
- `card_number`

### Masked Fields
- `cpf` - Shows first 3 and last 2 digits: `123*****89`
- `cnpj` - Shows first 3 and last 2 digits: `123*****89`
- `pis` - Fully redacted

### Example

```typescript
// Input
this.logger.info('User data', {
  name: 'John Doe',
  email: 'john@example.com',
  password: 'secret123',
  cpf: '12345678900'
});

// Output (password redacted, CPF masked)
{
  "message": "User data",
  "context": {
    "name": "John Doe",
    "email": "john@example.com",
    "password": "[REDACTED]",
    "cpf": "123*****00"
  }
}
```

---

## Log Analysis

### Find Errors in Last 24 Hours
```bash
# JSON logs
cat logs/error-$(date +%Y-%m-%d).log | jq 'select(.level == "error")'

# All logs
grep -i "error" logs/application-$(date +%Y-%m-%d).log
```

### Count Errors by Type
```bash
cat logs/error-*.log | jq -r '.context.error' | sort | uniq -c | sort -rn
```

### Find Slow Database Queries
```bash
cat logs/application-*.log | jq 'select(.message | contains("Slow database query"))'
```

### Track User Activity
```bash
# All actions by specific user
cat logs/application-*.log | jq 'select(.context.userId == "user_123")'
```

### Monitor Response Times
```bash
# HTTP requests over 1 second
cat logs/application-*.log | jq 'select(.context.responseTime? and (.context.responseTime | tonumber) > 1000)'
```

---

## Performance Tuning

### Reduce Log Volume
```bash
# Production settings
LOG_LEVEL="info"              # Skip debug and verbose
ENABLE_CONSOLE_LOGS="false"   # Disable console
ENABLE_FILE_LOGS="true"       # Enable files only
```

### Optimize Disk Usage
```bash
# Adjust retention in logger.service.ts
maxFiles: '7d'   # Instead of 14d for application logs
maxFiles: '14d'  # Instead of 30d for error logs
```

### Reduce File Size
```bash
# Adjust max size in logger.service.ts
maxSize: '10m'   # Instead of 20m
```

---

## Troubleshooting

### Logs Not Appearing

1. **Check log level:**
   ```bash
   echo $LOG_LEVEL
   # Should be 'debug' or 'info'
   ```

2. **Check console logs enabled:**
   ```bash
   echo $ENABLE_CONSOLE_LOGS
   # Should be 'true' for development
   ```

3. **Check file logs enabled:**
   ```bash
   echo $ENABLE_FILE_LOGS
   # Should be 'true' for file logging
   ```

### Log Directory Permissions

```bash
# Check directory exists and is writable
ls -la ./logs
# Should show drwxr-xr-x permissions

# If not, create and set permissions
mkdir -p ./logs
chmod 755 ./logs
```

### Disk Space Issues

```bash
# Check disk usage
du -sh ./logs

# Clean old logs manually if needed
find ./logs -name "*.log.gz" -mtime +30 -delete

# Or compress uncompressed logs
gzip ./logs/*.log
```

### Missing Log Files

Check that the log directory path is correct:
```bash
# In .env file
LOG_DIR="./logs"  # Relative to project root

# Or use absolute path
LOG_DIR="/var/log/ankaa-api"
```

---

## Production Deployment

### Recommended Settings

```bash
# .env.production
NODE_ENV="production"
LOG_LEVEL="info"
LOG_DIR="/var/log/ankaa-api"
LOG_FORMAT="json"
ENABLE_CONSOLE_LOGS="false"
ENABLE_FILE_LOGS="true"
```

### Log Shipping Setup

For centralized logging (ELK, Splunk, CloudWatch):

1. **Install log shipper:**
   ```bash
   # Example: Filebeat for ELK
   sudo apt-get install filebeat
   ```

2. **Configure shipper:**
   ```yaml
   # filebeat.yml
   filebeat.inputs:
   - type: log
     enabled: true
     paths:
       - /var/log/ankaa-api/application-*.log
     json.keys_under_root: true
   ```

3. **Start shipper:**
   ```bash
   sudo systemctl start filebeat
   sudo systemctl enable filebeat
   ```

### Log Rotation with logrotate

```bash
# /etc/logrotate.d/ankaa-api
/var/log/ankaa-api/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0644 www-data www-data
    sharedscripts
    postrotate
        systemctl reload ankaa-api
    endscript
}
```

---

## Monitoring Log Health

### Check Log File Growth

```bash
#!/bin/bash
# monitor-logs.sh

LOG_DIR="./logs"
MAX_SIZE_MB=100

for file in $LOG_DIR/*.log; do
    size_mb=$(du -m "$file" | cut -f1)
    if [ $size_mb -gt $MAX_SIZE_MB ]; then
        echo "WARNING: $file is ${size_mb}MB (exceeds ${MAX_SIZE_MB}MB)"
    fi
done
```

### Alert on Error Spikes

```bash
#!/bin/bash
# check-errors.sh

ERROR_THRESHOLD=100
error_count=$(cat logs/error-$(date +%Y-%m-%d).log | wc -l)

if [ $error_count -gt $ERROR_THRESHOLD ]; then
    echo "ALERT: $error_count errors logged today (threshold: $ERROR_THRESHOLD)"
    # Send notification
fi
```

---

## Common Log Patterns

### Successful Request
```json
{
  "timestamp": "2025-11-30 14:34:42",
  "level": "info",
  "message": "HTTP Request",
  "context": {
    "requestId": "req_1732976082719_a3b2c1d",
    "userId": "user_123",
    "method": "GET",
    "url": "/api/users/123",
    "statusCode": 200,
    "responseTime": "45ms"
  }
}
```

### Failed Request
```json
{
  "timestamp": "2025-11-30 14:34:43",
  "level": "error",
  "message": "HTTP Request",
  "context": {
    "requestId": "req_1732976083720_b4c3d2e",
    "userId": "user_123",
    "method": "POST",
    "url": "/api/orders",
    "statusCode": 500,
    "responseTime": "123ms"
  }
}
```

### Database Error
```json
{
  "timestamp": "2025-11-30 14:34:44",
  "level": "error",
  "message": "Database query failed",
  "context": {
    "module": "Database",
    "query": "INSERT INTO orders...",
    "duration": "52ms",
    "error": "Connection timeout"
  },
  "stack": "Error: Connection timeout\n    at ..."
}
```

---

## Best Practices

### 1. Use Appropriate Log Levels
- ❌ `logger.info('Database connected')`
- ✅ `logger.debug('Database connected')`

- ❌ `logger.error('User not found')`
- ✅ `logger.warn('User not found')`

### 2. Include Context
- ❌ `logger.info('File uploaded')`
- ✅ `logger.info('File uploaded', { filename, size, userId })`

### 3. Don't Log Sensitive Data
- ❌ `logger.info('Login successful', { password })`
- ✅ `logger.info('Login successful', { email })`

### 4. Use Structured Logging
- ❌ `logger.info(\`User \${id} updated order \${orderId}\`)`
- ✅ `logger.info('User updated order', { userId: id, orderId })`

### 5. Log Errors with Stack Traces
- ❌ `logger.error(error.message)`
- ✅ `logger.error(error.message, error.stack, context)`

---

## Support

For logging issues:
- Check logs in `./logs/` directory
- Review environment variables
- Verify file permissions
- Check disk space

**Last Updated:** 2025-11-30
