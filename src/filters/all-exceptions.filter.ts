import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost){
        
        //pega o http do host
        const ctx = host.switchToHttp();

        //pega o responde do host
        const response = ctx.getResponse<Response>();

        //variaveis para mensagem default
        let status = 500;
        let message: any = 'Erro interno do servidor'

        //HttpException é uma classe do proprio nest que contem os erros (400, 401, 403, 404, 409)
        if (exception instanceof HttpException){
            status = exception.getStatus();
            message = exception.getResponse();
        }

        //PrismaClientKnownRequestError é uma classe do proprio prisma que contem os erros do banco
        else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code ==='P2025'){
            status = 404;
            message = 'Registro não encontrado'
        }

        //monsta a mensagem e retorna
        response.status(status).json({
            statusCode: status,
            message,
        });
    }
}