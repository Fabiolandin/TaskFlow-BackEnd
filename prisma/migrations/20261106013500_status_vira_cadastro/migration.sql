-- SPEC-003a: status vira cadastro; prioridade vira conjunto fixo.
-- Gerado por `prisma migrate diff` e AJUSTADO à mão: o SQL gerado descartava a coluna
-- `status` (copiava as linhas sem ela e quebraria no NOT NULL de `idStatus`). Aqui o valor
-- de `status` é copiado para `idStatus`, os cadastros são semeados ANTES da cópia com os
-- ids em uso (1 e 2), e `prioridade` é normalizada para Baixa/Média/Alta/Urgente.

-- CreateTable
CREATE TABLE "StatusProjeto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "cor" TEXT,
    "ordem" INTEGER NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StatusTarefa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "cor" TEXT,
    "ordem" INTEGER NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Seed (manual): a lista do DialogNewProjeto (D-1) e a lista do DESIGN.md (D-2). Cores nulas.
INSERT INTO "StatusProjeto" ("id", "nome", "cor", "ordem", "isFinal", "updatedAt") VALUES
    (1, 'Mapeando',     NULL, 1, false, CURRENT_TIMESTAMP),
    (2, 'Em andamento', NULL, 2, false, CURRENT_TIMESTAMP),
    (3, 'Concluído',    NULL, 3, true,  CURRENT_TIMESTAMP),
    (4, 'Pausado',      NULL, 4, false, CURRENT_TIMESTAMP),
    (5, 'Cancelado',    NULL, 5, true,  CURRENT_TIMESTAMP);

INSERT INTO "StatusTarefa" ("id", "nome", "cor", "ordem", "isFinal", "updatedAt") VALUES
    (1, 'A Fazer',      NULL, 1, false, CURRENT_TIMESTAMP),
    (2, 'Em Andamento', NULL, 2, false, CURRENT_TIMESTAMP),
    (3, 'Em Revisão',   NULL, 3, false, CURRENT_TIMESTAMP),
    (4, 'Concluído',    NULL, 4, true,  CURRENT_TIMESTAMP);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Projetos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "idStatus" INTEGER NOT NULL,
    "data_inicio" DATETIME,
    "data_final" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Projetos_idStatus_fkey" FOREIGN KEY ("idStatus") REFERENCES "StatusProjeto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Ajuste manual: "status" → "idStatus" (o gerado omitia a coluna).
INSERT INTO "new_Projetos" ("createdAt", "data_final", "data_inicio", "descricao", "id", "idStatus", "nome", "updatedAt") SELECT "createdAt", "data_final", "data_inicio", "descricao", "id", "status", "nome", "updatedAt" FROM "Projetos";
DROP TABLE "Projetos";
ALTER TABLE "new_Projetos" RENAME TO "Projetos";
CREATE TABLE "new_Tarefas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "idStatus" INTEGER NOT NULL,
    "prioridade" TEXT NOT NULL,
    "data_inicio" DATETIME,
    "data_final" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "idUsuarioResponsavel" INTEGER,
    "idUsuarioCriador" INTEGER NOT NULL,
    "idProjeto" INTEGER NOT NULL,
    CONSTRAINT "Tarefas_idStatus_fkey" FOREIGN KEY ("idStatus") REFERENCES "StatusTarefa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idUsuarioResponsavel_fkey" FOREIGN KEY ("idUsuarioResponsavel") REFERENCES "Usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idUsuarioCriador_fkey" FOREIGN KEY ("idUsuarioCriador") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idProjeto_fkey" FOREIGN KEY ("idProjeto") REFERENCES "Projetos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Ajuste manual: "status" → "idStatus", e "prioridade" normalizada para a forma canônica.
INSERT INTO "new_Tarefas" ("createdAt", "data_final", "data_inicio", "descricao", "id", "idProjeto", "idStatus", "idUsuarioCriador", "idUsuarioResponsavel", "nome", "prioridade", "updatedAt")
SELECT "createdAt", "data_final", "data_inicio", "descricao", "id", "idProjeto", "status", "idUsuarioCriador", "idUsuarioResponsavel", "nome",
    CASE lower(trim("prioridade"))
        WHEN 'baixa'   THEN 'Baixa'
        WHEN 'media'   THEN 'Média'
        WHEN 'média'   THEN 'Média'
        WHEN 'alta'    THEN 'Alta'
        WHEN 'urgente' THEN 'Urgente'
        ELSE "prioridade"
    END,
    "updatedAt"
FROM "Tarefas";
DROP TABLE "Tarefas";
ALTER TABLE "new_Tarefas" RENAME TO "Tarefas";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
