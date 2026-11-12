-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "idTarefaPai" INTEGER,
    CONSTRAINT "Tarefas_idStatus_fkey" FOREIGN KEY ("idStatus") REFERENCES "StatusTarefa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idUsuarioResponsavel_fkey" FOREIGN KEY ("idUsuarioResponsavel") REFERENCES "Usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idUsuarioCriador_fkey" FOREIGN KEY ("idUsuarioCriador") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idProjeto_fkey" FOREIGN KEY ("idProjeto") REFERENCES "Projetos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idTarefaPai_fkey" FOREIGN KEY ("idTarefaPai") REFERENCES "Tarefas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Tarefas" ("createdAt", "data_final", "data_inicio", "descricao", "id", "idProjeto", "idStatus", "idUsuarioCriador", "idUsuarioResponsavel", "nome", "prioridade", "updatedAt") SELECT "createdAt", "data_final", "data_inicio", "descricao", "id", "idProjeto", "idStatus", "idUsuarioCriador", "idUsuarioResponsavel", "nome", "prioridade", "updatedAt" FROM "Tarefas";
DROP TABLE "Tarefas";
ALTER TABLE "new_Tarefas" RENAME TO "Tarefas";
CREATE INDEX "Tarefas_idTarefaPai_idx" ON "Tarefas"("idTarefaPai");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
