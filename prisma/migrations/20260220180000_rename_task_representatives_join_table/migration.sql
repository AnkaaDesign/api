-- Rename the many-to-many join table from _TaskRepresentatives to _TaskResponsibles
-- This matches the updated Prisma relation name @relation("TaskResponsibles")
ALTER TABLE "_TaskRepresentatives" RENAME TO "_TaskResponsibles";

-- Rename the index to match the new table name
ALTER INDEX "_TaskRepresentatives_AB_pkey" RENAME TO "_TaskResponsibles_AB_pkey";
ALTER INDEX "_TaskRepresentatives_B_index" RENAME TO "_TaskResponsibles_B_index";

-- Rename the foreign key constraints to match the new table name
ALTER TABLE "_TaskResponsibles" RENAME CONSTRAINT "_TaskRepresentatives_A_fkey" TO "_TaskResponsibles_A_fkey";
ALTER TABLE "_TaskResponsibles" RENAME CONSTRAINT "_TaskRepresentatives_B_fkey" TO "_TaskResponsibles_B_fkey";
