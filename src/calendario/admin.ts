import { ForbiddenException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/usuario-atual.decorator';

// D-4 do estudo (SPEC-023): o calendário é do admin; ler é de qualquer usuário logado
export const exigirAdminDoCalendario = (eu: UsuarioAutenticado) => {
  if (!eu.isAdmin) throw new ForbiddenException('Apenas administradores podem alterar o calendário');
};
