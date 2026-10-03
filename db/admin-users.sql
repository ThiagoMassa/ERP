-- New central module: register as its own incremental migration before production use.
create table erp_control.user_profiles (
 user_id uuid primary key references auth.users(id),
 display_name text not null check(length(btrim(display_name)) between 1 and 160),
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(), updated_by uuid not null references auth.users(id)
);
alter table erp_control.user_profiles enable row level security;
revoke all on erp_control.user_profiles from public,anon,authenticated;

create function erp_control.users_read(f jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; q text; company uuid; state text; confirmation text; page integer; result jsonb;
begin
 actor:=erp_control.require_admin(false);
 if jsonb_typeof(f)<>'object' or octet_length(f::text)>2048 or exists(select 1 from jsonb_object_keys(f) k where k not in ('query','company','status','confirmation','page','size')) then raise exception 'Filtros inválidos.';end if;
 q:=coalesce(f->>'query','');company:=nullif(f->>'company','')::uuid;state:=nullif(f->>'status','');confirmation:=nullif(f->>'confirmation','');page:=coalesce((f->>'page')::integer,0);
 if length(q)>160 or page not between 0 and 100000 or state not in ('active','blocked','suspended') or confirmation not in ('confirmed','pending') then raise exception 'Filtros inválidos.';end if;
 with matched as materialized (
 select a.id,a.email,coalesce(p.display_name,'') display_name,a.created_at,a.last_sign_in_at,a.email_confirmed_at,
 case when a.banned_until>now() and coalesce(ac.status,'active')='active' then 'blocked' else coalesce(ac.status,'active') end status,
 coalesce(ac.version,0) version,coalesce(p.version,0) profile_version
 from auth.users a left join erp_control.user_access ac on ac.user_id=a.id left join erp_control.user_profiles p on p.user_id=a.id
 where (q='' or strpos(lower(coalesce(a.email,'')),lower(q))>0 or strpos(lower(coalesce(p.display_name,'')),lower(q))>0 or a.id::text=q)
 and (company is null or exists(select 1 from erp_control.memberships m where m.user_id=a.id and m.company_id=company))
 and (confirmation is null or (confirmation='pending')=(a.email_confirmed_at is null))
 ), filtered as materialized(select * from matched where state is null or status=state),
 selected as (select * from filtered order by created_at desc,id limit 20 offset page*20)
 select jsonb_build_object('count',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('memberships',
 (select coalesce(jsonb_agg(jsonb_build_object('company_id',m.company_id,'name',bu.name,'role',m.role,'active',m.active,'version',m.version) order by bu.name,m.company_id),'[]') from erp_control.memberships m join public.business_units bu on bu.id=m.company_id where m.user_id=s.id)) order by s.created_at desc,s.id) from selected s),'[]')) into result;
 insert into erp_control.audit(actor_id,company_id,action,after_data,result)
 values(actor,company,'users.read',jsonb_build_object('filters',f,'count',result->'count','page',page),'success');
 return result;
end $$;

create function erp_control.user_profile_save(p_user uuid,p_name text,p_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; prior jsonb; updated jsonb; v integer; correlation uuid:=gen_random_uuid();
begin
 actor:=erp_control.require_admin(true);
 if p_user is null or p_name is null or length(btrim(p_name)) not between 1 and 160 or p_name~'[[:cntrl:]]' or p_reason is null or length(btrim(p_reason)) not between 10 and 1000 or p_version is null or p_version<0 then raise exception 'Dados cadastrais inválidos.';end if;
 -- Serializes first creation too: concurrent version-zero edits cannot both win.
 perform 1 from auth.users where id=p_user for update;
 if not found then raise exception 'Usuário não encontrado.';end if;
 select jsonb_build_object('display_name',display_name,'version',version),version into prior,v from erp_control.user_profiles where user_id=p_user;
 if coalesce(v,0)<>p_version then raise exception 'Registro alterado. Atualize antes de salvar.' using errcode='40001';end if;
 insert into erp_control.user_profiles(user_id,display_name,updated_by) values(p_user,btrim(p_name),actor)
 on conflict(user_id) do update set display_name=excluded.display_name,version=erp_control.user_profiles.version+1,updated_at=now(),updated_by=actor;
 select jsonb_build_object('display_name',display_name,'version',version) into updated from erp_control.user_profiles where user_id=p_user;
 insert into erp_control.audit(actor_id,subject_id,action,entity,before_data,after_data,reason,result,correlation_id)
 values(actor,p_user,'user.profile',p_user::text,prior,updated,btrim(p_reason),'success',correlation);
 return jsonb_build_object('ok',true,'version',updated->'version','correlation',correlation);
end $$;
create function public.erp_admin_users(p_filters jsonb) returns jsonb language sql security invoker set search_path='' as $$select erp_control.users_read(p_filters)$$;
create function public.erp_admin_user_profile(p_user uuid,p_name text,p_version integer,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select erp_control.user_profile_save(p_user,p_name,p_version,p_reason)$$;
revoke all on function erp_control.users_read(jsonb),erp_control.user_profile_save(uuid,text,integer,text),public.erp_admin_users(jsonb),public.erp_admin_user_profile(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function erp_control.users_read(jsonb),erp_control.user_profile_save(uuid,text,integer,text),public.erp_admin_users(jsonb),public.erp_admin_user_profile(uuid,text,integer,text) to authenticated;
