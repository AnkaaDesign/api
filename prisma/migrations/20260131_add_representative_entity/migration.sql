-- CreateEnum
CREATE TYPE "RepresentativeRole" AS ENUM ('COMMERCIAL', 'MARKETING', 'COORDINATOR', 'FINANCIAL', 'FLEET_MANAGER');

-- CreateTable
CREATE TABLE "Representative" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT,
    "customerId" TEXT NOT NULL,
    "role" "RepresentativeRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Representative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TaskRepresentatives" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Representative_email_key" ON "Representative"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Representative_phone_key" ON "Representative"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Representative_customerId_role_key" ON "Representative"("customerId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "_TaskRepresentatives_AB_unique" ON "_TaskRepresentatives"("A", "B");

-- CreateIndex
CREATE INDEX "_TaskRepresentatives_B_index" ON "_TaskRepresentatives"("B");

-- AddForeignKey
ALTER TABLE "Representative" ADD CONSTRAINT "Representative_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskRepresentatives" ADD CONSTRAINT "_TaskRepresentatives_A_fkey" FOREIGN KEY ("A") REFERENCES "Representative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskRepresentatives" ADD CONSTRAINT "_TaskRepresentatives_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add REPRESENTATIVE to ChangeLogEntityType enum
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'REPRESENTATIVE'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ChangeLogEntityType')
    ) THEN
        ALTER TYPE "ChangeLogEntityType" ADD VALUE 'REPRESENTATIVE';
    END IF;
END $$;

-- Migrate existing negotiatingWith data to Representatives
DO $$
DECLARE
    task_record RECORD;
    rep_id TEXT;
    existing_rep TEXT;
BEGIN
    -- Loop through all tasks with negotiatingWith data
    FOR task_record IN
        SELECT
            id,
            "customerId",
            "negotiatingWith"
        FROM "Task"
        WHERE "negotiatingWith" IS NOT NULL
        AND "customerId" IS NOT NULL
    LOOP
        -- Extract name and phone from JSON
        IF task_record."negotiatingWith"->>'name' IS NOT NULL
           AND task_record."negotiatingWith"->>'phone' IS NOT NULL
           AND LENGTH(TRIM(task_record."negotiatingWith"->>'name')) > 0
           AND LENGTH(TRIM(task_record."negotiatingWith"->>'phone')) > 0 THEN

            -- Check if representative already exists for this phone
            SELECT id INTO existing_rep
            FROM "Representative"
            WHERE phone = task_record."negotiatingWith"->>'phone'
            LIMIT 1;

            IF existing_rep IS NULL THEN
                -- Create new representative with COMMERCIAL role
                INSERT INTO "Representative" (
                    id,
                    name,
                    phone,
                    "customerId",
                    role,
                    "isActive",
                    "createdAt",
                    "updatedAt"
                )
                VALUES (
                    gen_random_uuid(),
                    task_record."negotiatingWith"->>'name',
                    task_record."negotiatingWith"->>'phone',
                    task_record."customerId",
                    'COMMERCIAL',
                    true,
                    NOW(),
                    NOW()
                )
                RETURNING id INTO rep_id;
            ELSE
                rep_id := existing_rep;

                -- Update customer if different (in case phone was reused)
                UPDATE "Representative"
                SET "customerId" = task_record."customerId"
                WHERE id = rep_id
                AND "customerId" != task_record."customerId";
            END IF;

            -- Create relationship between task and representative
            INSERT INTO "_TaskRepresentatives" ("A", "B")
            VALUES (rep_id, task_record.id)
            ON CONFLICT DO NOTHING;

            RAISE NOTICE 'Migrated task % with representative %', task_record.id, rep_id;
        END IF;
    END LOOP;

    -- Log migration summary
    RAISE NOTICE 'Migration complete. Created % representatives from negotiatingWith data',
        (SELECT COUNT(*) FROM "Representative");
END $$;

-- Optional: Comment out if you want to keep negotiatingWith for backward compatibility
-- ALTER TABLE "Task" DROP COLUMN "negotiatingWith";