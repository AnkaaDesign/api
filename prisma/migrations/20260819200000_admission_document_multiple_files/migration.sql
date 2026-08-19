-- Documentos da admissão passam a aceitar VÁRIOS arquivos (frente/verso do RG,
-- páginas da CTPS…). Relação implícita N:N do Prisma: tabela `_ADMISSION_DOCUMENT_FILES`
-- com A = File.id e B = AdmissionDocument.id (ordem alfabética dos modelos).
CREATE TABLE "_ADMISSION_DOCUMENT_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_ADMISSION_DOCUMENT_FILES_AB_unique" ON "_ADMISSION_DOCUMENT_FILES"("A", "B");
CREATE INDEX "_ADMISSION_DOCUMENT_FILES_B_index" ON "_ADMISSION_DOCUMENT_FILES"("B");

ALTER TABLE "_ADMISSION_DOCUMENT_FILES"
    ADD CONSTRAINT "_ADMISSION_DOCUMENT_FILES_A_fkey"
    FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ADMISSION_DOCUMENT_FILES"
    ADD CONSTRAINT "_ADMISSION_DOCUMENT_FILES_B_fkey"
    FOREIGN KEY ("B") REFERENCES "AdmissionDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: todo documento que já tem um arquivo vira o primeiro item do conjunto,
-- para que a tela nova não apareça vazia sobre os documentos já enviados.
INSERT INTO "_ADMISSION_DOCUMENT_FILES" ("A", "B")
SELECT d."fileId", d."id"
FROM "AdmissionDocument" d
WHERE d."fileId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Nenhum documento da admissão é obrigatório: o avanço da etapa não é mais
-- bloqueado por checklist. A coluna fica como marcação informativa.
ALTER TABLE "AdmissionDocument" ALTER COLUMN "required" SET DEFAULT false;
UPDATE "AdmissionDocument" SET "required" = false WHERE "required" = true;
