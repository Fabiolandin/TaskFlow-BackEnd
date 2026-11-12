-- SPEC-021 (RF-81, RF-83): papel de admin e email normalizado. Aprovada pelo Fabio em 2026-11-12, sem backup.
-- AlterTable
ALTER TABLE "Usuarios" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- o admin12 (id 3) é o único admin inicial (D-3)
UPDATE "Usuarios" SET "isAdmin" = true WHERE "id" = 3;

-- emails gravados sem espaços nas pontas e em minúsculas (RF-83)
UPDATE "Usuarios" SET "email" = lower(trim("email"));
