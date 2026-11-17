import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";

//P2025 por modelo do Prisma
const NAO_ENCONTRADO: Record<string, string> = {
    Usuarios: 'Usuário não encontrado',
    Projetos: 'Projeto não encontrado',
    UsuariosProjetos: 'Membro do projeto não encontrado',
    Tarefas: 'Tarefa não encontrada',
    ComentariosTarefas: 'Comentário não encontrado',
    Labels: 'Label não encontrada',
    LabelsTarefas: 'Label da tarefa não encontrada',
    StatusProjeto: 'Status de projeto não encontrado',
    StatusTarefa: 'Status de tarefa não encontrado',
    Jornadas: 'Jornada não encontrada',
    Feriados: 'Feriado não encontrado',
    Ausencias: 'Ausência não encontrada',
    Sprints: 'Sprint não encontrada',
    ItensSprint: 'Item da sprint não encontrado',
    Apontamentos: 'Apontamento não encontrado',
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost){
        
        //pega o http do host
        const ctx = host.switchToHttp();

        //pega o responde do host
        const response = ctx.getResponse<Response>();

        //variaveis para mensagem default
        let status = 500;
        let message: string = 'Erro interno do servidor'
        //SPEC-024: campos extras que a exceção declara de propósito em `detalhes` (ex.: emSprint no 409 da
        //exclusão de tarefa); nada mais do corpo vaza
        let detalhes: Record<string, unknown> = {}

        //HttpException é uma classe do proprio nest que contem os erros (400, 401, 403, 404, 409)
        //a message sai sempre como texto: corpo string, ou o campo message do corpo objeto (lista vira texto único) (SPEC-011)
        if (exception instanceof HttpException){
            status = exception.getStatus();
            const corpo = exception.getResponse();
            const texto = typeof corpo === 'object' && corpo !== null ? (corpo as { message?: unknown }).message : corpo;
            message = typeof texto === 'string' ? texto
                : Array.isArray(texto) ? texto.join('; ')
                : exception.message;
            const extra = typeof corpo === 'object' && corpo !== null ? (corpo as { detalhes?: unknown }).detalhes : undefined;
            if (typeof extra === 'object' && extra !== null && !Array.isArray(extra)) detalhes = extra as Record<string, unknown>;
        }

        //PrismaClientKnownRequestError é uma classe do proprio prisma que contem os erros do banco
        else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code ==='P2025'){
            status = 404;
            //diz o quê não foi achado (ex.: "Tarefa não encontrada"); modelo desconhecido fica no texto genérico
            message = NAO_ENCONTRADO[String(exception.meta?.modelName)] ?? 'Registro não encontrado'
        }

        //P2003 é violação de chave estrangeira
        //em DELETE: o registro está em uso por outro e o banco recusa a exclusão (SPEC-002)
        //nos demais métodos: o pedido aponta para um registro que não existe (SPEC-011)
        else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code ==='P2003'){
            if (ctx.getRequest<Request>().method === 'DELETE'){
                status = 409;
                message = 'Registro em uso: não pode ser excluído porque outros registros dependem dele'
            } else {
                status = 400;
                message = 'Referência inexistente: um dos registros informados não existe'
            }
        }

        //P2002 é violação de campo único (ex.: email repetido): o registro já existe
        else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code ==='P2002'){
            status = 409;
            message = exception.meta?.modelName === 'Usuarios'
                ? 'Este email já está em uso por outro usuário'
                : 'Já existe um registro com esse valor'
        }

        //monsta a mensagem e retorna
        response.status(status).json({
            ...detalhes,
            statusCode: status,
            message,
        });
    }
}