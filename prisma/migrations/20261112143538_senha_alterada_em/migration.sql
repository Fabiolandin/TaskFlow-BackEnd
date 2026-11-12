-- SPEC-022 (RF-92): data da última troca de senha. Aprovada pelo Fabio em 2026-11-12, sem backup.
-- AlterTable
ALTER TABLE "Usuarios" ADD COLUMN "senhaAlteradaEm" DATETIME;
