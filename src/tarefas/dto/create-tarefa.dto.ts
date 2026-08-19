export class CreateTarefaDto {
    nome: string
    descricao: string
    status: number
    prioridade: string
    data_inicio: Date
    data_final: Date
    idUsuarioResponsavel: number
    idUsuarioCriador : number
    idProjeto: number
    createdAt: Date
    updatedAt: Date
    labelIds?: number[]
}
