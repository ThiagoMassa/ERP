-- Run after tenant-routing.sql within BEGIN/ROLLBACK on the central control DB.
do $$
declare u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid(); c jsonb; denied boolean;
begin
 insert into auth.users(id,email) values(u,'tenant-route-'||u||'@example.invalid'),(other_user,'tenant-route-'||other_user||'@example.invalid');
 insert into auth.sessions(id,user_id,created_at,aal) values(sid,u,now(),'aal1');
 insert into public.business_units(id,owner_id,name,model) values(b,u,'Roteamento A','printing'),(other_company,other_user,'Roteamento B','retail');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'exp',floor(extract(epoch from now()+interval '1 hour')),'iat',floor(extract(epoch from now())),'aal','aal1')::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 c:=public.erp_tenant_context(b);
 if c->>'actor'<>u::text or c->>'company'<>b::text or c->>'provisioning'<>'pending' or c->'permissions'->'stock'->'read'->>'allowed'<>'true' then raise exception 'FAIL contexto central';end if;
 if (c->>'expires_at')::timestamptz<=now() or (c->>'expires_at')::timestamptz>now()+interval '30 seconds' then raise exception 'FAIL expiração';end if;
 denied:=false;begin perform public.erp_tenant_context(other_company);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL troca de empresa';end if;
 insert into erp_control.permissions(company_id,scope,subject,module,action,allowed) values(b,'company','*','stock','available',false);
 c:=public.erp_tenant_context(b);
 if c->'permissions'->'stock'->'read'->>'allowed'<>'false' then raise exception 'FAIL próxima requisição ignora bloqueio';end if;
 update erp_control.memberships set active=false where company_id=b and user_id=u;
 denied:=false;begin perform public.erp_tenant_context(b);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL desvínculo';end if;
 update erp_control.memberships set active=true where company_id=b and user_id=u;
 delete from auth.sessions where id=sid;
 denied:=false;begin perform public.erp_tenant_context(b);exception when invalid_authorization_specification then denied:=true;end;
 if not denied then raise exception 'FAIL sessão revogada';end if;
 if has_function_privilege('anon','public.erp_tenant_context(uuid)','EXECUTE') then raise exception 'FAIL anon';end if;
 raise notice 'PASS contexto central: empresa autorizada, política fresca, troca de empresa negada, desvínculo e sessão revogada';
end $$;
