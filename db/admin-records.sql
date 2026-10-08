-- Central read authorization for controlled administrative inspection.
-- Depends on admin-control and tenant-backup-control; does not enable corrections.
create function erp_control.admin_record_context(b uuid,operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;c erp_control.companies;permissions jsonb:='{}';actions jsonb;m text;a text;correlation uuid:=gen_random_uuid();
begin
 actor:=erp_control.require_admin(false);
 if b is null or operation is null or operation not in ('products','partners','orders','order_detail','titles','title_detail','stock','movements','jobs','spools','printers','recipes','record_history') then raise exception 'Selecione empresa e consulta administrativa válidas.' using errcode='42501';end if;
 select * into c from erp_control.companies where id=b;
 if c.id is null or c.provisioning<>'ready' then raise exception 'Banco indisponível para consulta administrativa.' using errcode='42501';end if;
 -- A suspended company remains inspectable by ADM. A database in maintenance does not.
 foreach m in array array['overview','sales','purchases','catalog','stock','finance','production','settings'] loop
  actions:='{}';foreach a in array array['available','visible','read','create','edit','delete','approve','cancel','reverse','export'] loop
   actions:=actions||jsonb_build_object(a,jsonb_build_object('allowed',a in ('available','visible','read'),'origin','Consulta administrativa global'));
  end loop;permissions:=permissions||jsonb_build_object(m,actions);
 end loop;
 insert into erp_control.audit(actor_id,company_id,action,entity,after_data,result,correlation_id)
 values(actor,b,'records.authorize.read',operation,jsonb_build_object('operation',operation),'success',correlation);
 return jsonb_build_object('actor',actor,'company',b,'expires_at',clock_timestamp()+interval '25 seconds','permissions',permissions,'administrative_read',true,'admin_read_operation',operation,
 'provisioning',c.provisioning,'database_identity',c.database_identity,'credential_ref',c.credential_ref,'schema_version',c.schema_version,'access_epoch',c.access_epoch,'correlation',correlation);
end $$;
create function public.erp_admin_record_context(p_company uuid,p_operation text) returns jsonb
language sql security invoker set search_path='' as $$select erp_control.admin_record_context(p_company,p_operation)$$;
revoke all on function erp_control.admin_record_context(uuid,text),public.erp_admin_record_context(uuid,text) from public,anon;
grant execute on function erp_control.admin_record_context(uuid,text),public.erp_admin_record_context(uuid,text) to authenticated;
