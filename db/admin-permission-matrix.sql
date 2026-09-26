-- One authorized server snapshot; the UI never infers permission precedence.
create function erp_control.permission_matrix(b uuid,target uuid,correlation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=erp_control.require_admin(false);member erp_control.memberships;result jsonb:='{}';actions jsonb;m text;a text;company_name text;email text;
begin
 select * into member from erp_control.memberships where company_id=b and user_id=target;
 if member.user_id is null then raise exception 'Usuário sem vínculo nesta empresa.' using errcode='42501';end if;
 select name into company_name from public.business_units where id=b;
 select u.email into email from auth.users u where u.id=target;
 foreach m in array array['overview','sales','purchases','catalog','stock','finance','production','settings'] loop
  actions:='{}';
  foreach a in array array['available','visible','read','create','edit','delete','approve','cancel','reverse','export'] loop
   actions:=actions||jsonb_build_object(a,erp_control.effective(b,target,m,a));
  end loop;
  result:=result||jsonb_build_object(m,actions);
 end loop;
 insert into erp_control.audit(actor_id,company_id,subject_id,action,entity,result,correlation_id)
 values(actor,b,target,'permissions.inspect',target::text,'success',correlation);
 return jsonb_build_object('company',b,'company_name',company_name,'user',target,'email',email,'role',member.role,'membership_active',member.active,
 'company_archived',exists(select 1 from public.business_units where id=b and deleted_at is not null),
 'login_blocked',exists(select 1 from auth.users where id=target and banned_until>now()),
 'permissions',result,'overrides',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'module',module,'action',action,'allowed',allowed,'version',version)),'[]') from erp_control.permissions where company_id=b and scope='user' and subject=target::text),
 'checked_at',clock_timestamp());
end $$;
create function public.erp_admin_permission_matrix(p_company uuid,p_user uuid,p_correlation uuid) returns jsonb
language sql security invoker set search_path='' as $$select erp_control.permission_matrix(p_company,p_user,p_correlation)$$;
revoke all on function erp_control.permission_matrix(uuid,uuid,uuid),public.erp_admin_permission_matrix(uuid,uuid,uuid) from public,anon;
grant execute on function erp_control.permission_matrix(uuid,uuid,uuid),public.erp_admin_permission_matrix(uuid,uuid,uuid) to authenticated;
