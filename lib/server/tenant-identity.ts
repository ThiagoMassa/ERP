const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Identifiers come from the authorized company UUID, never a browser-supplied name. */
export function tenantIdentity(companyId: string) {
  if (!uuid.test(companyId)) throw new Error('Identificador de empresa inválido.');
  const company = companyId.toLowerCase();
  const suffix = company.replaceAll('-', '');
  return {
    company,
    database: `erp_${suffix}`,
    owner: `erp_owner_${suffix}`,
    runtime: `erp_app_${suffix}`,
    credentialRef: `ERP_TENANT_${suffix.toUpperCase()}_URL`,
  };
}

export class TenantConfigurationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/** No connection URL or underlying driver exception may reach an HTTP response. */
export function tenantConnectionOptions(
  connection: string,
  companyId: string,
  options: { allowLocalTest?: boolean; ca?: string } = {},
) {
  const identity = tenantIdentity(companyId);
  let url: URL;
  try { url = new URL(connection); } catch {
    throw new TenantConfigurationError('INVALID_CONNECTION', 'Conexão empresarial inválida.');
  }
  const username = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.password ||
      database !== identity.database ||
      // Supavisor appends the project reference to the PostgreSQL role.
      !(username === identity.runtime || new RegExp(`^${identity.runtime}\\.[a-z0-9]{20}$`).test(username)) ||
      url.search || url.hash) {
    throw new TenantConfigurationError('IDENTITY_MISMATCH', 'A credencial não corresponde ao banco e ao usuário restrito desta empresa.');
  }
  const local = options.allowLocalTest === true && ['127.0.0.1', '[::1]'].includes(url.hostname);
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 5432),
    database,
    username,
    password: decodeURIComponent(url.password),
    ssl: local ? false as const : { rejectUnauthorized: true, ...(options.ca ? { ca: options.ca } : {}) },
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 10,
    max_lifetime: 60,
    debug: false as const,
    onnotice: () => {},
    connection: { application_name: 'fluxo-tenant', statement_timeout: 15000, lock_timeout: 5000 },
  };
}
