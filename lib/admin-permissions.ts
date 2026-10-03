export const permissionModules=[['overview','Visão geral'],['sales','Vendas'],['purchases','Compras'],['catalog','Catálogo'],['stock','Estoque'],['finance','Financeiro'],['production','Produção 3D'],['settings','Configurações']] as const;
export const permissionActions=[['available','Disponível'],['visible','Visível'],['read','Consultar'],['create','Criar'],['edit','Editar'],['delete','Inativar'],['approve','Confirmar'],['cancel','Cancelar'],['reverse','Estornar'],['export','Exportar']] as const;
export const permissionRoles:Record<string,string>={admin:'Administrador da empresa',sales:'Comercial',purchases:'Compras',stock:'Estoque',finance:'Financeiro',read:'Leitura'};
export const permissionScopes:Record<string,string>={company:'Empresa',role:'Perfil',user:'Usuário'};
export function permissionOrigin(origin:string){return origin.startsWith('Perfil: ')?'Perfil: '+(permissionRoles[origin.slice(8)]||origin.slice(8)):origin;}
