-- Apply admin-permission-matrix.sql, then execute this entire test in BEGIN/ROLLBACK.
do $$
declare adm uuid:=gen_random_uuid();member_id uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();msid uuid:=gen_random_uuid();factor uuid:=gen_random_uuid();b uuid:=gen_random_uuid();correlation uuid:=gen_random_uuid();token jsonb;result jsonb;denied boolean;
begin
 insert into auth.users(id,email) values(adm,'matrix-adm-'||adm||'@example.invalid'),(member_id,'matrix-member-'||member_id||'@example.invalid');
 insert into auth.sessions(id,user_id,created_at,aal) values(sid,adm,now(),'aal2'),(msid,member_id,now(),'aal1');
 insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(factor,adm,'totp','verified',now(),now());
 insert into erp_control.administrators(user_id) values(adm);
 insert into public.business_units(id,owner_id,name,model) values(b,adm,'Matriz de acesso','printing');
 insert into erp_control.memberships(company_id,user_id,role) values(b,member_id,'read');
 token:=jsonb_build_object('sub',member_id,'session_id',msid,'exp',floor(extract(epoch from now()+interval '1 hour')),'iat',floor(extract(epoch from now())),'aal','aal1');
 perform set_config('request.jwt.claims',token::text,true);
 denied:=false;begin perform public.erp_admin_permission_matrix(b,member_id,correlation);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL usuário comum consulta matriz';end if;
 token:=token||jsonb_build_object('sub',adm,'session_id',sid,'aal','aal2');
 perform set_config('request.jwt.claims',token::text,true);
 result:=public.erp_admin_permission_matrix(b,member_id,correlation);
 if (select count(*) from jsonb_object_keys(result->'permissions'))<>8 or (select count(*) from jsonb_object_keys(result->'permissions'->'catalog'))<>10 then raise exception 'FAIL matriz incompleta';end if;
 if (result->'permissions'->'catalog'->'read'->>'allowed')::boolean is not true or (result->'permissions'->'catalog'->'edit'->>'allowed')::boolean is not false then raise exception 'FAIL perfil leitura';end if;
 insert into erp_control.permissions(company_id,scope,subject,module,action,allowed) values(b,'user',member_id::text,'catalog','edit',true),(b,'company','*','catalog','available',false);
 result:=public.erp_admin_permission_matrix(b,member_id,correlation);
 if (result->'permissions'->'catalog'->'edit'->>'allowed')::boolean is not false or jsonb_array_length(result->'overrides')<>1 or (result->'overrides'->0->>'version')::integer<>1 then raise exception 'FAIL precedência ou versão';end if;
 update erp_control.memberships set active=false where company_id=b and user_id=member_id;
 result:=public.erp_admin_permission_matrix(b,member_id,correlation);
 if (result->>'membership_active')::boolean is not false or exists(select 1 from jsonb_each(result->'permissions') m cross join lateral jsonb_each(m.value) a where (a.value->>'allowed')::boolean) then raise exception 'FAIL vínculo suspenso';end if;
 if not exists(select 1 from erp_control.audit where actor_id=adm and company_id=b and subject_id=member_id and action='permissions.inspect' and correlation_id=correlation) then raise exception 'FAIL consulta sem auditoria';end if;
 denied:=false;begin perform public.erp_admin_permission_matrix(b,gen_random_uuid(),correlation);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL usuário fora do contexto';end if;
 if has_function_privilege('anon','public.erp_admin_permission_matrix(uuid,uuid,uuid)','execute') then raise exception 'FAIL matriz anônima';end if;
 raise notice 'PASS matriz: ADM obrigatório, 80 decisões atuais, bloqueio prevalece, vínculo suspenso nega, versões e consulta auditada';
end $$;
