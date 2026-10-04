-- Incremental extension of the installed context; paired with tenant migration 009.
create or replace function erp_control.admin_correction_context(b uuid,operation text,entity uuid,reason text,correlation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;c erp_control.companies;permissions jsonb;
begin
 actor:=erp_control.require_admin(true);
 if b is null or entity is null or correlation is null or (operation is null or operation not in ('admin.product.correct','admin.product.archive','admin.product.restore')) or reason is null or length(btrim(reason)) not between 10 and 1000 then
  raise exception 'Correção administrativa inválida.' using errcode='42501';
 end if;
 select * into c from erp_control.companies where id=b;
 if c.id is null or c.provisioning<>'ready' then raise exception 'Banco indisponível para correção administrativa.' using errcode='42501';end if;
 permissions:=jsonb_build_object('catalog',jsonb_build_object('available',jsonb_build_object('allowed',true),case when operation='admin.product.archive' then 'delete' else 'edit' end,jsonb_build_object('allowed',true)));
 insert into erp_control.audit(actor_id,company_id,action,entity,after_data,reason,result,correlation_id)
 values(actor,b,'records.authorize.correct',entity::text,jsonb_build_object('operation',operation),btrim(reason),'success',correlation);
 return jsonb_build_object('actor',actor,'company',b,'expires_at',clock_timestamp()+interval '25 seconds','permissions',permissions,
  'administrative',true,'admin_action',operation,'provisioning',c.provisioning,'database_identity',c.database_identity,
  'credential_ref',c.credential_ref,'schema_version',c.schema_version,'access_epoch',c.access_epoch);
end $$;
