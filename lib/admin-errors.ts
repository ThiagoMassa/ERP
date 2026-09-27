/** Only reviewed business messages may cross the administrative HTTP boundary. */
const publicMessages=new Set([
 'Descreva o motivo em 10 a 1000 caracteres.',
 'Não é permitido bloquear ou revogar a própria conta por este formulário.',
 'Usuário não encontrado.',
 'Registro alterado. Atualize antes de salvar.',
 'Registro alterado ou empresa indisponível. Atualize antes de salvar.',
 'Empresa não encontrada.',
 'Vínculo alterado. Atualize antes de salvar.',
 'Usuário sem vínculo nesta empresa.',
 'Permissão alterada. Atualize antes de salvar.',
 'Somente a verificação do servidor pode liberar um banco como pronto.',
 'Banco ativo exige fluxo de manutenção.',
 'Selecione uma empresa.',
]);
export function adminErrorMessage(value:unknown):string{
 return typeof value==='string'&&publicMessages.has(value)?value:'Operação indisponível. Atualize os dados e confirme sua identidade administrativa antes de tentar novamente.';
}
