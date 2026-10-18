import {DatabaseSync} from 'node:sqlite';
import {parseEnv} from 'node:util';
import {readFile,mkdir,copyFile,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const env=parseEnv(await readFile(join(root,'.env'),'utf8'));
const source=resolve(root,env.DB_PATH||'storage/village.db'),backups=join(root,'backups');
const stamp=new Date().toISOString().replaceAll(':','-')+'-'+process.pid;
await mkdir(backups,{recursive:true,mode:0o700});
if(existsSync(source)){
 const db=new DatabaseSync(source,{readOnly:true});
 try{const destination=join(backups,'village-'+stamp+'.db');db.prepare('VACUUM INTO ?').run(destination);await chmod(destination,0o600);console.log('Consistent SQLite backup saved: '+destination);}finally{db.close();}
}
const privateCopy=join(backups,'private-env-'+stamp);await copyFile(join(root,'.env'),privateCopy);await chmod(privateCopy,0o600);
console.log('Private configuration backup saved; no secrets printed.');
