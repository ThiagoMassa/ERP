import type {Row} from './operations';

export type PermissionAction='available'|'visible'|'read'|'create'|'edit'|'delete'|'approve'|'cancel'|'reverse'|'export';
export const permissionModule:Record<string,string>={overview:'overview',orders:'sales',purchases:'purchases',products:'catalog',partners:'catalog',marketplace:'catalog',pricing:'catalog',titles:'finance',accounts:'finance',stock:'stock',movements:'stock',legacy_movements:'stock',warehouses:'stock',jobs:'production',spools:'production',printers:'production',recipes:'production',files:'production',studio:'production',settings:'settings',members:'settings',terms:'settings',audit:'settings',admin:'settings'};
export function decision(permissions:Row,area:string,action:PermissionAction):{allowed:boolean;origin:string}{
 const areaKey=permissionModule[area]||area;
 const group=permissions[areaKey] as Record<string,{allowed?:boolean;origin?:string}>|undefined;
 if(!group)return {allowed:false,origin:'Permissões ainda não carregadas ou função sem política.'};
 if(group.available?.allowed!==true)return {allowed:false,origin:group.available?.origin||'Módulo indisponível.'};
 return {allowed:group[action]?.allowed===true,origin:group[action]?.origin||'Ação sem política.'};
}
export function commandPolicy(action:string,row:Row,orderKind:string):{area:string;action:PermissionAction}|null{
 const prefix=action.split('.')[0];
 const area=({business:'settings',member:'settings',warehouse:'settings',terms:'settings',product:'catalog',partner:'catalog',stock:'stock',title:'finance',payment:'finance',account:'finance',printer:'production',spool:'production',recipe:'production',file:'production',job:'production',order:orderKind==='purchase'?'purchases':'sales',fulfillment:orderKind==='purchase'?'purchases':'sales'} as Record<string,string>)[prefix];
 if(!area)return null;
 const suffix=action.split('.')[1];
 const operation:PermissionAction|undefined=({archive:'delete',restore:'edit',reverse:'reverse',cancel:'cancel',confirm:'approve',fulfill:'approve',start:'approve',finish:'approve',convert:'create',adjust:'create',transfer:'create',save:row.id?'edit':'create'} as Record<string,PermissionAction>)[suffix];
 return operation?{area,action:operation}:null;
}

