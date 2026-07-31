-- Inscrição municipal do tomador: vai para a NFS-e (campo "Insc. Municipal" da DANFSe).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "municipalRegistration" TEXT;
