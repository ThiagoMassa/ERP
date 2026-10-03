-- Incremental central authorization; install after admin-records.
-- Paired with tenant migration 007 and the controlled correction endpoint.
create function erp_control.admin_correction_context(b uuid,operation text,entity uuid,reason text,correlation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;c erp_control.companies;permissions jsonb;
begin
 actor:=erp_control.require_admin(true);
 if b is null or entity is null or correlation is null or operation is distinct from 'admin.product.correct' or reason is null or length(btrim(reason)) not between 10 and 1000 then
  raise exception 'Correção administrativa inválida.' using errcode='42501';
 end if;
 select * into c from erp_control.companies where id=b;
 if c.id is null or c.provisioning<>'ready' then raise exception 'Banco indisponível para correção administrativa.' using errcode='42501';end if;
 permissions:=jsonb_build_object('catalog',jsonb_build_object('available',jsonb_build_object('allowed',true),'edit',jsonb_build_object('allowed',true)));
 insert into erp_control.audit(actor_id,company_id,action,entity,after_data,reason,result,correlation_id)
 values(actor,b,'records.authorize.correct',entity::text,jsonb_build_object('operation',operation),btrim(reason),'success',correlation);
 return jsonb_build_object('actor',actor,'company',b,'expires_at',clock_timestamp()+interval '25 seconds','permissions',permissions,
  'administrative',true,'admin_action',operation,'provisioning',c.provisioning,'database_identity',c.database_identity,
  'credential_ref',c.credential_ref,'schema_version',c.schema_version,'access_epoch',c.access_epoch);
end $$;
create function public.erp_admin_correction_context(p_company uuid,p_operation text,p_entity uuid,p_reason text,p_correlation uuid) returns jsonb
language sql security invoker set search_path='' as $$select erp_control.admin_correction_context(p_company,p_operation,p_entity,p_reason,p_correlation)$$;
revoke all on function erp_control.admin_correction_context(uuid,text,uuid,text,uuid),public.erp_admin_correction_context(uuid,text,uuid,text,uuid) from public,anon;
grant execute on function erp_control.admin_correction_context(uuid,text,uuid,text,uuid),public.erp_admin_correction_context(uuid,text,uuid,text,uuid) to authenticated;
