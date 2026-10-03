create or replace function erp_control.effective(p_company uuid,p_user uuid,p_module text,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text; matches jsonb; permitted boolean;
begin
 if p_module is null or p_action is null or p_module not in ('overview','sales','purchases','catalog','stock','finance','production','settings') or p_action not in ('available','visible','read','create','edit','delete','approve','cancel','reverse','export') then return jsonb_build_object('allowed',false,'origin','Função desconhecida');end if;
 if not exists(select 1 from erp_control.companies where id=p_company and status='active') then return jsonb_build_object('allowed',false,'origin','Empresa suspensa ou não cadastrada');end if;
 if exists(select 1 from erp_control.user_access where user_id=p_user and status<>'active') then return jsonb_build_object('allowed',false,'origin','Conta bloqueada');end if;
 select role into r from erp_control.memberships where company_id=p_company and user_id=p_user and active;
 if r is null then return jsonb_build_object('allowed',false,'origin','Sem vínculo ativo');end if;
 select jsonb_agg(jsonb_build_object('scope',scope,'action',action,'allowed',allowed)) into matches from erp_control.permissions
 where company_id=p_company and module=p_module and action in (p_action,'available') and
 (scope='company' or scope='role' and subject=r or scope='user' and subject=p_user::text);
 if exists(select 1 from jsonb_array_elements(coalesce(matches,'[]')) x where x->>'allowed'='false') then return jsonb_build_object('allowed',false,'origin','Bloqueio explícito','rules',matches);end if;
 if exists(select 1 from jsonb_array_elements(coalesce(matches,'[]')) x where x->>'action'=p_action and x->>'allowed'='true') then return jsonb_build_object('allowed',true,'origin','Permissão explícita','rules',matches);end if;
 permitted:=r='admin' or (p_action in ('available','visible','read') and p_module<>'settings') or r=p_module or r='stock' and p_module='production' or p_module='catalog' and r in ('sales','purchases','stock');
 return jsonb_build_object('allowed',permitted,'origin','Perfil: '||r,'rules',coalesce(matches,'[]'));
end $$;

