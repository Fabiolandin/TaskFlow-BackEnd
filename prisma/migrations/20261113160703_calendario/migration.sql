-- CreateTable
CREATE TABLE "Jornadas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idUsuario" INTEGER NOT NULL,
    "vigencia" DATETIME NOT NULL,
    "seg" INTEGER NOT NULL,
    "ter" INTEGER NOT NULL,
    "qua" INTEGER NOT NULL,
    "qui" INTEGER NOT NULL,
    "sex" INTEGER NOT NULL,
    "sab" INTEGER NOT NULL,
    "dom" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Jornadas_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feriados" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "data" DATETIME NOT NULL,
    "nome" TEXT NOT NULL,
    "minutosDescontados" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Ausencias" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idUsuario" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "dataInicio" DATETIME NOT NULL,
    "dataFim" DATETIME NOT NULL,
    "minutosPorDia" INTEGER,
    "observacao" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ausencias_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Jornadas_idUsuario_vigencia_key" ON "Jornadas"("idUsuario", "vigencia");

-- CreateIndex
CREATE UNIQUE INDEX "Feriados_data_key" ON "Feriados"("data");

-- CreateIndex
CREATE INDEX "Ausencias_idUsuario_dataInicio_idx" ON "Ausencias"("idUsuario", "dataInicio");

