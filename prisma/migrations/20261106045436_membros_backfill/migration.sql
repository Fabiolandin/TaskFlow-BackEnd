-- SPEC-010: projeto passa a ter membros (tabela UsuariosProjetos, que já existe).
-- Sem mudança de estrutura: só backfill de dados (D-4). O usuário 1 é criador das tarefas
-- do projeto 1 e passa a ser membro dele.
--
-- Escrito à mão (o `prisma migrate dev --create-only` gerou migration vazia, porque o schema
-- não mudou). Seguro para qualquer banco: só insere se o usuário 1 E o projeto 1 existirem
-- (não cria FK órfã, mesmo com foreign_keys desligado) e se o vínculo ainda não existir
-- (não viola o índice único em idUsuario + idProjeto). Num banco vazio, insere 0 linhas.
-- Datas no mesmo formato que o Prisma grava.

INSERT INTO "UsuariosProjetos" ("idUsuario", "idProjeto", "createdAt", "updatedAt")
SELECT u."id", p."id",
       strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'),
       strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
FROM "Usuarios" u
JOIN "Projetos" p ON p."id" = 1
WHERE u."id" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "UsuariosProjetos" up
    WHERE up."idUsuario" = u."id" AND up."idProjeto" = p."id"
  );
