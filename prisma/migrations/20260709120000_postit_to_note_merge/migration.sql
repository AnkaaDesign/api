-- Merge "Post-it" → unified "Note": rename table + owner column in place (preserving
-- all existing rows and changelog history), add title/archivedAt, add note sharing.

-- 1) Rename the changelog entity enum value in place (existing ChangeLog rows follow automatically).
ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'POSTIT' TO 'NOTE';

-- 2) Rename table Postit → Note.
ALTER TABLE "Postit" RENAME TO "Note";

-- 3) Rename owner column userId → ownerId.
ALTER TABLE "Note" RENAME COLUMN "userId" TO "ownerId";

-- 4) Rename PK / indexes / FK to match Prisma naming conventions for the new model.
ALTER INDEX "Postit_pkey" RENAME TO "Note_pkey";
ALTER INDEX "Postit_userId_idx" RENAME TO "Note_ownerId_idx";
ALTER INDEX "Postit_isArchived_idx" RENAME TO "Note_isArchived_idx";
ALTER INDEX "Postit_position_idx" RENAME TO "Note_position_idx";
ALTER TABLE "Note" RENAME CONSTRAINT "Postit_userId_fkey" TO "Note_ownerId_fkey";

-- 5) New scalar columns.
ALTER TABLE "Note" ADD COLUMN "title" TEXT;
ALTER TABLE "Note" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 6) Accent-insensitive search column for title (generated, matches contentNormalized pattern).
ALTER TABLE "Note"
  ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("title"))) STORED;

-- 7) Note sharing (viewer/editor) join table.
CREATE TABLE "NoteShare" (
    "noteId"   TEXT NOT NULL,
    "userId"   TEXT NOT NULL,
    "canEdit"  BOOLEAN NOT NULL DEFAULT false,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoteShare_pkey" PRIMARY KEY ("noteId", "userId")
);
CREATE INDEX "NoteShare_noteId_idx" ON "NoteShare"("noteId");
CREATE INDEX "NoteShare_userId_idx" ON "NoteShare"("userId");
ALTER TABLE "NoteShare"
  ADD CONSTRAINT "NoteShare_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteShare"
  ADD CONSTRAINT "NoteShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
