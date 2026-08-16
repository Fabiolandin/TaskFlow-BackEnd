-- CreateTable
CREATE TABLE "Usuarios" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Projetos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" INTEGER NOT NULL,
    "data_inicio" DATETIME,
    "data_final" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UsuariosProjetos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idUsuario" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "idProjeto" INTEGER NOT NULL,
    CONSTRAINT "UsuariosProjetos_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UsuariosProjetos_idProjeto_fkey" FOREIGN KEY ("idProjeto") REFERENCES "Projetos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tarefas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" INTEGER NOT NULL,
    "prioridade" TEXT NOT NULL,
    "data_inicio" DATETIME,
    "data_final" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "idUsuarioResponsavel" INTEGER,
    "idUsuarioCriador" INTEGER NOT NULL,
    "idProjeto" INTEGER NOT NULL,
    CONSTRAINT "Tarefas_idUsuarioResponsavel_fkey" FOREIGN KEY ("idUsuarioResponsavel") REFERENCES "Usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idUsuarioCriador_fkey" FOREIGN KEY ("idUsuarioCriador") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tarefas_idProjeto_fkey" FOREIGN KEY ("idProjeto") REFERENCES "Projetos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComentariosTarefas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "comentario" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "idTarefa" INTEGER NOT NULL,
    "idUsuario" INTEGER NOT NULL,
    CONSTRAINT "ComentariosTarefas_idTarefa_fkey" FOREIGN KEY ("idTarefa") REFERENCES "Tarefas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComentariosTarefas_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Labels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "nome" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "LabelsTarefas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "idLabel" INTEGER NOT NULL,
    "idTarefa" INTEGER NOT NULL,
    CONSTRAINT "LabelsTarefas_idLabel_fkey" FOREIGN KEY ("idLabel") REFERENCES "Labels" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabelsTarefas_idTarefa_fkey" FOREIGN KEY ("idTarefa") REFERENCES "Tarefas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuarios_email_key" ON "Usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UsuariosProjetos_idUsuario_idProjeto_key" ON "UsuariosProjetos"("idUsuario", "idProjeto");

-- CreateIndex
CREATE UNIQUE INDEX "LabelsTarefas_idLabel_idTarefa_key" ON "LabelsTarefas"("idLabel", "idTarefa");
