import { Injectable } from '@nestjs/common';

// RF-103 (SPEC-023): quem busca os feriados nacionais. Injetado por token para os testes
// trocarem por um cliente falso, sem ir à rede. Nenhum dado do usuário vai na chamada.
export const CLIENTE_FERIADOS = Symbol('CLIENTE_FERIADOS');

export interface ClienteFeriados {
  //devolve o JSON cru da BrasilAPI; quem chama valida o formato
  buscar(ano: number): Promise<unknown>;
}

const TIMEOUT_MS = 10_000;

@Injectable()
export class ClienteBrasilApi implements ClienteFeriados {
  async buscar(ano: number): Promise<unknown> {
    const resposta = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resposta.ok) throw new Error(`BrasilAPI respondeu ${resposta.status}`);
    return resposta.json();
  }
}
