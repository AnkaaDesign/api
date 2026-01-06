/**
 * Device Token Schema for Prisma
 *
 * Add this to your schema.prisma file:
 *
 * model DeviceToken {
 *   id        String   @id @default(uuid())
 *   userId    String
 *   token     String   @unique
 *   platform  Platform
 *   isActive  Boolean  @default(true)
 *   createdAt DateTime @default(now())
 *   updatedAt DateTime @updatedAt
 *
 *   user      User     @relation("USER_DEVICE_TOKENS", fields: [userId], references: [id], onDelete: Cascade)
 *
 *   @@index([userId])
 *   @@index([platform])
 * }
 *
 * enum Platform {
 *   IOS
 *   ANDROID
 *   WEB
 * }
 *
 * Also add to the User model:
 *   deviceTokens DeviceToken[] @relation("USER_DEVICE_TOKENS")
 */

export const DEVICE_TOKEN_SCHEMA = `
model DeviceToken {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  platform  Platform
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user      User     @relation("USER_DEVICE_TOKENS", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([platform])
}

enum Platform {
  IOS
  ANDROID
  WEB
}
`;
