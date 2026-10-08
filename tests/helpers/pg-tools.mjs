import {resolve} from 'node:path';
export const pgTestTool=name=>resolve(process.env.ERP_TEST_PG_BIN||'work/postgresql/pgsql/bin',name+(process.platform==='win32'?'.exe':''));
