# Firebase Environment Variables Quick Reference

## Required Environment Variables

### Option 1: Individual Variables (Production)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `FIREBASE_PROJECT_ID` | ✅ | Your Firebase project ID | `my-app-12345` |
| `FIREBASE_PRIVATE_KEY` | ✅ | Service account private key (with `\n` for line breaks) | `"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"` |
| `FIREBASE_CLIENT_EMAIL` | ✅ | Service account email address | `firebase-adminsdk-xxxxx@my-app.iam.gserviceaccount.com` |

### Option 2: Service Account File (Development)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `FIREBASE_SERVICE_ACCOUNT_PATH` | ✅ | Path to service account JSON file | `./config/firebase-service-account.json` |

## Additional Configuration

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `WEB_APP_URL` | ❌ | Web application base URL | `https://yourapp.com` |
| `MOBILE_APP_SCHEME` | ❌ | Mobile app URL scheme | `yourapp://` |
| `WEB_BASE_URL` | ❌ | Base URL for web deep links | `https://yourapp.com` |
| `MOBILE_UNIVERSAL_LINK` | ❌ | Universal link for iOS/Android | `https://yourapp.com/app` |

## Configuration Priority

If both options are provided, the system uses this priority:

1. **FIREBASE_SERVICE_ACCOUNT_PATH** (if set and file exists)
2. **Individual variables** (FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL)

## Quick Copy Templates

### Development (.env)

```bash
# Option 1: Environment Variables
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Key-Here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com

# OR Option 2: Service Account File
# FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
```

### Production (Environment Variables Only)

```bash
FIREBASE_PROJECT_ID=your-production-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Production-Key\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-production-project.iam.gserviceaccount.com
```

### Docker Compose

```yaml
environment:
  - FIREBASE_PROJECT_ID=your-project-id
  - FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Key-Here\n-----END PRIVATE KEY-----\n"
  - FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

### Kubernetes Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: firebase-credentials
type: Opaque
stringData:
  FIREBASE_PROJECT_ID: "your-project-id"
  FIREBASE_PRIVATE_KEY: |
    -----BEGIN PRIVATE KEY-----
    Your-Key-Here
    -----END PRIVATE KEY-----
  FIREBASE_CLIENT_EMAIL: "firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com"
```

## Extracting Values from Service Account JSON

If you have a `firebase-service-account.json` file:

```json
{
  "project_id": "...",        // → FIREBASE_PROJECT_ID
  "private_key": "...",       // → FIREBASE_PRIVATE_KEY
  "client_email": "..."       // → FIREBASE_CLIENT_EMAIL
}
```

### Using jq (Linux/Mac)

```bash
# Extract project ID
export FIREBASE_PROJECT_ID=$(jq -r '.project_id' firebase-service-account.json)

# Extract client email
export FIREBASE_CLIENT_EMAIL=$(jq -r '.client_email' firebase-service-account.json)

# Extract private key
export FIREBASE_PRIVATE_KEY=$(jq -r '.private_key' firebase-service-account.json)
```

### Manual Copy

1. Open the JSON file
2. Copy the value of `project_id` to `FIREBASE_PROJECT_ID`
3. Copy the value of `private_key` to `FIREBASE_PRIVATE_KEY` (keep the quotes and `\n`)
4. Copy the value of `client_email` to `FIREBASE_CLIENT_EMAIL`

## Important Notes

### Private Key Format

⚠️ **Critical**: The private key must preserve newline characters.

**Correct Format**:
```bash
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG...\n-----END PRIVATE KEY-----\n"
```

**Incorrect Format**:
```bash
# ❌ Missing quotes
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...

# ❌ Missing \n characters
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkqhkiG...-----END PRIVATE KEY-----"

# ❌ Actual newlines instead of \n
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG...
-----END PRIVATE KEY-----"
```

### Security Checklist

- [ ] Never commit `.env` files with real credentials
- [ ] Never commit `firebase-service-account.json` files
- [ ] Use `.env.example` for templates only
- [ ] Store production credentials in secure vault
- [ ] Rotate credentials regularly
- [ ] Use different credentials per environment

## Validation

### Check if Variables are Set

```bash
# Check environment variables
echo "Project ID: $FIREBASE_PROJECT_ID"
echo "Client Email: $FIREBASE_CLIENT_EMAIL"
echo "Private Key Set: $([ -n "$FIREBASE_PRIVATE_KEY" ] && echo "Yes" || echo "No")"
```

### Test Configuration

```bash
# Start the application and check logs
npm run dev

# Look for these log messages:
# ✅ [FirebaseConfigService] Firebase Admin SDK initialized successfully
# ❌ [FirebaseConfigService] Firebase credentials not configured
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Missing required environment variables" | Set all three variables or use service account file path |
| "INVALID_ARGUMENT" | Check private key format (must have `\n` characters) |
| "Service account file not found" | Verify the path in `FIREBASE_SERVICE_ACCOUNT_PATH` |
| "Permission denied" | Check service account has FCM permissions in Firebase Console |

## See Also

- [Firebase Setup Guide](./FIREBASE_SETUP.md)
- [Configuration Summary](../../../../FIREBASE_CONFIGURATION_SUMMARY.md)
- [Main .env.example](../../../../.env.example)
