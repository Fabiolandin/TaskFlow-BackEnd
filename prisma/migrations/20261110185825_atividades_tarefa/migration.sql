-- CreateTable
CREATE TABLE "AtividadesTarefa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idTarefa" INTEGER NOT NULL,
    "idUsuario" INTEGER,
    "nomeUsuario" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "idAnterior" INTEGER,
    "idNovo" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AtividadesTarefa_idTarefa_fkey" FOREIGN KEY ("idTarefa") REFERENCES "Tarefas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AtividadesTarefa_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AtividadesTarefa_idTarefa_createdAt_idx" ON "AtividadesTarefa"("idTarefa", "createdAt");
