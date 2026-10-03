// Private operator environment only; no credentials or arbitrary URLs in arguments.
import postgres from 'postgres';
import {prepareLegacyPhotoBundle} from '../lib/server/legacy-photo-bundle.ts';
import {operatorConnection} from '../lib/server/operator-connection.ts';
import {tenantIdentity,TenantConfigurationError} from '../lib/server/tenant-identity.ts';

if(process.argv.includes('--help')){
 console.log('Uso: node --experimental-strip-types scripts/prepare-legacy-photos.mjs UUID_DA_SOLICITACAO\nERP_CONTROL_OPERATOR_URL, ERP_CONTROL_CA, ERP_LEGACY_PHOTO_EXPORT e ERP_LEGACY_PHOTO_BUNDLE ficam no ambiente privado. Leia TENANT-ASSETS.md antes de exportar.');
 process.exit(0);
}
let control;
try{
 const job=tenantIdentity(process.argv[2]||'').company;
 const {ERP_LEGACY_PHOTO_EXPORT:input,ERP_LEGACY_PHOTO_BUNDLE:output}=process.env;
 if(!input||!output)throw new TenantConfigurationError('CONFIGURATION','Configure a pasta da exportação e uma pasta nova para o pacote de fotos.');
 control=postgres(operatorConnection(process.env.ERP_CONTROL_OPERATOR_URL,process.env.ERP_CONTROL_CA));
 console.log(JSON.stringify(await prepareLegacyPhotoBundle(control,job,input,output)));
}catch(error){
 console.error(error instanceof TenantConfigurationError?error.message:'Pacote não concluído. Confira a exportação, as referências e uma pasta de destino nova; detalhes de conexão não são exibidos.');
 process.exitCode=1;
}finally{await control?.end({timeout:2});}
