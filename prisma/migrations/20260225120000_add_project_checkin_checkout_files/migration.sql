-- CreateTable (implicit many-to-many join tables for new file relations)

-- Create join table for Task <-> File (TASK_PROJECT_FILES)
CREATE TABLE IF NOT EXISTS "_TASK_PROJECT_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TASK_PROJECT_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TASK_PROJECT_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create unique index on (A, B)
CREATE UNIQUE INDEX "_TASK_PROJECT_FILES_AB_unique" ON "_TASK_PROJECT_FILES"("A", "B");

-- Create index on B
CREATE INDEX "_TASK_PROJECT_FILES_B_index" ON "_TASK_PROJECT_FILES"("B");

-- Create join table for Task <-> File (TASK_CHECKIN_FILES)
CREATE TABLE IF NOT EXISTS "_TASK_CHECKIN_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TASK_CHECKIN_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TASK_CHECKIN_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create unique index on (A, B)
CREATE UNIQUE INDEX "_TASK_CHECKIN_FILES_AB_unique" ON "_TASK_CHECKIN_FILES"("A", "B");

-- Create index on B
CREATE INDEX "_TASK_CHECKIN_FILES_B_index" ON "_TASK_CHECKIN_FILES"("B");

-- Create join table for Task <-> File (TASK_CHECKOUT_FILES)
CREATE TABLE IF NOT EXISTS "_TASK_CHECKOUT_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TASK_CHECKOUT_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TASK_CHECKOUT_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create unique index on (A, B)
CREATE UNIQUE INDEX "_TASK_CHECKOUT_FILES_AB_unique" ON "_TASK_CHECKOUT_FILES"("A", "B");

-- Create index on B
CREATE INDEX "_TASK_CHECKOUT_FILES_B_index" ON "_TASK_CHECKOUT_FILES"("B");

-- Data migration: rename folder paths in File.path
-- 1. Pricing layouts: /Layouts/Orcamentos/ → /Layouts/ (must run BEFORE the Projetos→Layouts rename)
UPDATE "File" SET "path" = REPLACE("path", '/Layouts/Orcamentos/', '/Layouts/') WHERE "path" LIKE '%/Layouts/Orcamentos/%';

-- 2. Artwork files: /Projetos/ → /Layouts/
UPDATE "File" SET "path" = REPLACE("path", '/Projetos/', '/Layouts/') WHERE "path" LIKE '%/Projetos/%';

-- 3. Layout photos: /Auxiliares/Traseiras/Fotos/ → /Traseiras/
UPDATE "File" SET "path" = REPLACE("path", '/Auxiliares/Traseiras/Fotos/', '/Traseiras/') WHERE "path" LIKE '%/Auxiliares/Traseiras/Fotos/%';
