import type {Sql} from 'postgres';
import {tenantIdentity, TenantConfigurationError} from './tenant-identity.ts';

/** Private operator only. Catalog inspection; no role, grant or database mutations. */
export async function tenantPreflight(sql: Sql, companyId: string) {
  const identity = tenantIdentity(companyId);
  const [operator] = await sql<{can_create_database: boolean; can_create_role: boolean}[]>`
    select (rolsuper or rolcreatedb) as can_create_database,
           (rolsuper or rolcreaterole) as can_create_role
    from pg_roles where rolname=current_user`;
  if (!operator) throw new TenantConfigurationError('CONFIGURATION', 'Não foi possível verificar o papel do operador.');
  const databases = await sql<{database: string; public_connect: boolean; runtime_connect: boolean; operator_can_manage: boolean}[]>`
    select d.datname as database,
      exists(select 1 from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
        where a.grantee=0 and a.privilege_type='CONNECT') as public_connect,
      case when r.oid is null then false else has_database_privilege(r.oid,d.oid,'CONNECT') end as runtime_connect,
      pg_has_role(current_user,d.datdba,'SET') as operator_can_manage
    from pg_database d left join pg_roles r on r.rolname=${identity.runtime}
    where d.datallowconn and d.datname<>${identity.database}
    order by d.datname`;
  const conflicts = databases.filter(d => d.public_connect || d.runtime_connect);
  return {
    company: identity.company,
    database: identity.database,
    checks: operator,
    connection_conflicts: conflicts,
    can_attempt_automatic_provisioning: operator.can_create_database && operator.can_create_role && conflicts.length === 0,
    // Passing this inspection is not proof of identity, migration, TLS or reconciliation.
    ready: false as const,
  };
}

export function assertProvisionPreflight(report: Awaited<ReturnType<typeof tenantPreflight>>, existingOnly = false) {
  if (report.connection_conflicts.length) throw new TenantConfigurationError('UNSAFE_CLUSTER',
    'O servidor permite conexão a outras bases. Execute a verificação prévia e revise o isolamento com o provedor; nenhum banco ou perfil foi criado.');
  if (!existingOnly && !report.can_attempt_automatic_provisioning) throw new TenantConfigurationError('MANUAL_PROVISIONING_REQUIRED',
    'O operador não pode criar bancos/perfis. Solicite o provisionamento manual ao responsável pelo servidor; nenhuma empresa foi ativada.');
}
