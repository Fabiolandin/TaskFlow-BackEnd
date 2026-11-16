-- AlterTable
ALTER TABLE "Tarefas" ADD COLUMN "issueExterna" TEXT;
ALTER TABLE "Tarefas" ADD COLUMN "minutosBuffer" INTEGER;
ALTER TABLE "Tarefas" ADD COLUMN "minutosEstimados" INTEGER;
ALTER TABLE "Tarefas" ADD COLUMN "solicitante" TEXT;

-- CreateTable
CREATE TABLE "Sprints" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "dataInicio" DATETIME NOT NULL,
    "dataFim" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Planejamento',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ItensSprint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idSprint" INTEGER NOT NULL,
    "idTarefa" INTEGER,
    "nome" TEXT,
    "minutosAvulsos" INTEGER,
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "idUsuario" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "naoPrevista" BOOLEAN NOT NULL DEFAULT false,
    "inicioPrevisto" DATETIME,
    "entregaPrevista" DATETIME,
    "minutosPlanejadosFixos" INTEGER,
    "idItemOrigem" INTEGER,
    "evolucao" INTEGER NOT NULL DEFAULT 0,
    "bloqueio" TEXT,
    "observacao" TEXT,
    "dataEntregaReal" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ItensSprint_idSprint_fkey" FOREIGN KEY ("idSprint") REFERENCES "Sprints" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItensSprint_idTarefa_fkey" FOREIGN KEY ("idTarefa") REFERENCES "Tarefas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItensSprint_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItensSprint_idItemOrigem_fkey" FOREIGN KEY ("idItemOrigem") REFERENCES "ItensSprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ItensSprint_idSprint_idUsuario_ordem_idx" ON "ItensSprint"("idSprint", "idUsuario", "ordem");

-- CreateIndex
CREATE INDEX "ItensSprint_idTarefa_idx" ON "ItensSprint"("idTarefa");

