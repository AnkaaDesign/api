import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

/**
 * Firebase Configuration Service
 *
 * Centralizes Firebase Admin SDK initialization and configuration.
 * Supports multiple initialization methods:
 * 1. Environment variables (FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL)
 * 2. Service account JSON file (FIREBASE_SERVICE_ACCOUNT_PATH)
 *
 * This service ensures Firebase is initialized only once and provides
 * access to Firebase Admin services throughout the application.
 */
@Injectable()
export class FirebaseConfigService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseConfigService.name);
  private firebaseApp: admin.app.App | null = null;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Initialize Firebase Admin SDK on module initialization
   * Automatically called when the module is loaded
   */
  async onModuleInit(): Promise<void> {
    await this.initializeFirebase();
  }

  /**
   * Initialize Firebase Admin SDK with service account credentials
   * Supports two methods:
   * 1. Individual environment variables (recommended for production)
   * 2. Service account JSON file path (recommended for development)
   *
   * @returns Promise<boolean> - True if initialization successful, false otherwise
   */
  async initializeFirebase(): Promise<boolean> {
    try {
      // Check if Firebase is already initialized
      if (admin.apps.length > 0) {
        this.firebaseApp = admin.apps[0];
        this.initialized = true;
        this.logger.log('Firebase Admin SDK already initialized');
        return true;
      }

      // Method 1: Try loading from service account file path
      const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');

      if (serviceAccountPath) {
        this.logger.log('Initializing Firebase from service account file...');
        return await this.initializeFromServiceAccountFile(serviceAccountPath);
      }

      // Method 2: Load from individual environment variables
      this.logger.log('Initializing Firebase from environment variables...');
      return await this.initializeFromEnvironmentVariables();
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error.stack);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Initialize Firebase from service account JSON file
   *
   * @param filePath - Path to the service account JSON file
   * @returns Promise<boolean> - Success status
   */
  private async initializeFromServiceAccountFile(filePath: string): Promise<boolean> {
    try {
      const serviceAccount = require(filePath);

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });

      this.initialized = true;
      this.logger.log(`Firebase Admin SDK initialized from file: ${filePath}`);
      this.logger.log(`Project ID: ${serviceAccount.project_id}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to load service account from file: ${filePath}`, error.message);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Initialize Firebase from individual environment variables
   *
   * @returns Promise<boolean> - Success status
   */
  private async initializeFromEnvironmentVariables(): Promise<boolean> {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    // Validate required credentials
    if (!projectId || !privateKey || !clientEmail) {
      this.logger.warn(
        'Firebase credentials not configured. Push notifications will be disabled. ' +
          'Please set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL ' +
          'or FIREBASE_SERVICE_ACCOUNT_PATH environment variables.',
      );
      this.initialized = false;
      return false;
    }

    try {
      // Replace escaped newlines in private key
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey: formattedPrivateKey,
          clientEmail,
        }),
        projectId,
      });

      this.initialized = true;
      this.logger.log('Firebase Admin SDK initialized successfully');
      this.logger.log(`Project ID: ${projectId}`);
      this.logger.log(`Client Email: ${clientEmail}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize Firebase from environment variables', error.message);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Get Firebase App instance
   *
   * @returns admin.app.App | null - Firebase app instance or null if not initialized
   */
  getApp(): admin.app.App | null {
    if (!this.initialized || !this.firebaseApp) {
      this.logger.warn('Firebase app not initialized. Please check your configuration.');
      return null;
    }
    return this.firebaseApp;
  }

  /**
   * Get Firebase Messaging instance
   *
   * @returns admin.messaging.Messaging | null - Firebase messaging instance or null if not initialized
   */
  getMessaging(): admin.messaging.Messaging | null {
    const app = this.getApp();
    if (!app) {
      return null;
    }
    return admin.messaging(app);
  }

  /**
   * Get Firebase Firestore instance
   *
   * @returns admin.firestore.Firestore | null - Firebase firestore instance or null if not initialized
   */
  getFirestore(): admin.firestore.Firestore | null {
    const app = this.getApp();
    if (!app) {
      return null;
    }
    return admin.firestore(app);
  }

  /**
   * Get Firebase Auth instance
   *
   * @returns admin.auth.Auth | null - Firebase auth instance or null if not initialized
   */
  getAuth(): admin.auth.Auth | null {
    const app = this.getApp();
    if (!app) {
      return null;
    }
    return admin.auth(app);
  }

  /**
   * Check if Firebase is initialized and ready
   *
   * @returns boolean - True if Firebase is initialized, false otherwise
   */
  isInitialized(): boolean {
    return this.initialized && this.firebaseApp !== null;
  }

  /**
   * Validate Firebase configuration without initializing
   * Useful for health checks and configuration validation
   *
   * @returns Promise<{ valid: boolean; message: string }> - Validation result
   */
  async validateConfiguration(): Promise<{ valid: boolean; message: string }> {
    const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    // Check if service account path is provided
    if (serviceAccountPath) {
      const fs = require('fs');
      if (fs.existsSync(serviceAccountPath)) {
        return {
          valid: true,
          message: `Service account file found at: ${serviceAccountPath}`,
        };
      } else {
        return {
          valid: false,
          message: `Service account file not found at: ${serviceAccountPath}`,
        };
      }
    }

    // Check if individual credentials are provided
    if (!projectId || !privateKey || !clientEmail) {
      const missing = [];
      if (!projectId) missing.push('FIREBASE_PROJECT_ID');
      if (!privateKey) missing.push('FIREBASE_PRIVATE_KEY');
      if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');

      return {
        valid: false,
        message: `Missing required environment variables: ${missing.join(', ')}`,
      };
    }

    return {
      valid: true,
      message: 'Firebase credentials configured via environment variables',
    };
  }

  /**
   * Get current Firebase configuration summary
   * Useful for debugging and health checks
   * Does not expose sensitive credentials
   *
   * @returns object - Configuration summary
   */
  getConfigurationSummary(): {
    initialized: boolean;
    projectId: string | null;
    clientEmail: string | null;
    hasPrivateKey: boolean;
    configMethod: 'file' | 'env' | 'none';
  } {
    const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    let configMethod: 'file' | 'env' | 'none' = 'none';
    if (serviceAccountPath) {
      configMethod = 'file';
    } else if (projectId && privateKey && clientEmail) {
      configMethod = 'env';
    }

    return {
      initialized: this.initialized,
      projectId: projectId || null,
      clientEmail: clientEmail || null,
      hasPrivateKey: !!privateKey,
      configMethod,
    };
  }
}
