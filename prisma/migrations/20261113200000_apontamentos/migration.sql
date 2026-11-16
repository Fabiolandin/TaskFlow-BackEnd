-- CreateTable
CREATE TABLE "Apontamentos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idUsuario" INTEGER NOT NULL,
    "data" DATETIME NOT NULL,
    "inicioMin" INTEGER NOT NULL,
    "fimMin" INTEGER NOT NULL,
    "idItemSprint" INTEGER,
    "observacao" TEXT,
    "foraDaSprint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Apontamentos_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Apontamentos_idItemSprint_fkey" FOREIGN KEY ("idItemSprint") REFERENCES "ItensSprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Apontamentos_idUsuario_data_idx" ON "Apontamentos"("idUsuario", "data");

-- CreateIndex
CREATE INDEX "Apontamentos_idItemSprint_idx" ON "Apontamentos"("idItemSprint");

