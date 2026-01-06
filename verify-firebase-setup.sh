#!/bin/bash

echo "========================================="
echo "Firebase Configuration Verification"
echo "========================================="
echo ""

# Check if firebase-admin is installed
echo "1. Checking firebase-admin package..."
if npm list firebase-admin > /dev/null 2>&1; then
    VERSION=$(npm list firebase-admin | grep firebase-admin | awk '{print $2}' | sed 's/@//')
    echo "   ✓ firebase-admin is installed (version $VERSION)"
else
    echo "   ✗ firebase-admin is NOT installed"
    echo "   Run: npm install firebase-admin"
    exit 1
fi
echo ""

# Check if Firebase config service exists
echo "2. Checking Firebase configuration service..."
if [ -f "src/modules/common/notification/push/firebase-config.service.ts" ]; then
    echo "   ✓ FirebaseConfigService exists"
else
    echo "   ✗ FirebaseConfigService NOT found"
    exit 1
fi
echo ""

# Check if environment variables are documented
echo "3. Checking environment variable documentation..."
if grep -q "FIREBASE_PROJECT_ID" .env.example; then
    echo "   ✓ Firebase variables documented in .env.example"
else
    echo "   ✗ Firebase variables NOT documented"
fi
echo ""

# Check if .gitignore includes Firebase credentials
echo "4. Checking .gitignore configuration..."
if grep -q "firebase-service-account" .gitignore; then
    echo "   ✓ Firebase credentials added to .gitignore"
else
    echo "   ✗ Firebase credentials NOT in .gitignore"
fi
echo ""

# Check if environment variables are set (optional)
echo "5. Checking environment variables (optional)..."
if [ -n "$FIREBASE_PROJECT_ID" ]; then
    echo "   ✓ FIREBASE_PROJECT_ID is set: $FIREBASE_PROJECT_ID"
else
    echo "   ⚠ FIREBASE_PROJECT_ID not set (this is OK for initial setup)"
fi

if [ -n "$FIREBASE_CLIENT_EMAIL" ]; then
    echo "   ✓ FIREBASE_CLIENT_EMAIL is set: $FIREBASE_CLIENT_EMAIL"
else
    echo "   ⚠ FIREBASE_CLIENT_EMAIL not set (this is OK for initial setup)"
fi

if [ -n "$FIREBASE_PRIVATE_KEY" ]; then
    echo "   ✓ FIREBASE_PRIVATE_KEY is set (length: ${#FIREBASE_PRIVATE_KEY} chars)"
else
    echo "   ⚠ FIREBASE_PRIVATE_KEY not set (this is OK for initial setup)"
fi

if [ -n "$FIREBASE_SERVICE_ACCOUNT_PATH" ]; then
    echo "   ✓ FIREBASE_SERVICE_ACCOUNT_PATH is set: $FIREBASE_SERVICE_ACCOUNT_PATH"
    if [ -f "$FIREBASE_SERVICE_ACCOUNT_PATH" ]; then
        echo "   ✓ Service account file exists"
    else
        echo "   ✗ Service account file NOT found at: $FIREBASE_SERVICE_ACCOUNT_PATH"
    fi
fi
echo ""

# Check documentation files
echo "6. Checking documentation files..."
DOCS=(
    "FIREBASE_CONFIGURATION_SUMMARY.md"
    "src/modules/common/notification/push/FIREBASE_SETUP.md"
    "src/modules/common/notification/push/ENV_VARIABLES.md"
    "src/modules/common/push/.env.example"
)

for doc in "${DOCS[@]}"; do
    if [ -f "$doc" ]; then
        echo "   ✓ $doc"
    else
        echo "   ✗ $doc NOT found"
    fi
done
echo ""

echo "========================================="
echo "Verification Complete!"
echo "========================================="
echo ""
echo "Next Steps:"
echo "1. Create a Firebase project at https://console.firebase.google.com/"
echo "2. Generate service account credentials"
echo "3. Configure environment variables in .env file"
echo "4. Run 'npm run dev' to start the application"
echo "5. Check logs for: '[FirebaseConfigService] Firebase Admin SDK initialized successfully'"
echo ""
echo "For detailed instructions, see:"
echo "  - FIREBASE_CONFIGURATION_SUMMARY.md"
echo "  - src/modules/common/notification/push/FIREBASE_SETUP.md"
echo ""
