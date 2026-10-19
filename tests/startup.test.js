import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parseEnv} from 'node:util';

test('SMTP launcher creates secrets only on a new install and never rewrites an existing configuration',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dv-smtp-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'deploy'));await copyFile('deploy/start-workshop.mjs',join(root,'deploy/start-workshop.mjs'));
 await writeFile(join(root,'server.js'),'process.exit(0)');
 const config='SMTP_EMAIL=test@example.invalid\nSMTP_APP_PASSWORD=synthetic-password\nPUBLIC_BASE_URL=https://game.example.invalid\nDEV_EMAIL_OUTBOX=0\n';
 await writeFile(join(root,'smtp.env'),config+'PRIVACY_CONTACT=YOUR_CONTACT_EMAIL\n');
 let child=spawnSync(process.execPath,['deploy/start-workshop.mjs'],{cwd:root,encoding:'utf8'});assert.equal(child.status,1);
 await writeFile(join(root,'smtp.env'),config);
 child=spawnSync(process.execPath,['deploy/start-workshop.mjs'],{cwd:root,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const original=await readFile(join(root,'.env'),'utf8'),env=parseEnv(original);
 assert.equal(env.ADMIN_PASSWORD.length,48);assert.equal(env.PIN_PEPPER.length,64);assert.equal(child.stdout.includes(env.ADMIN_PASSWORD),false);
 await writeFile(join(root,'smtp.env'),'INVALID_NEW_CONFIG');
 child=spawnSync(process.execPath,['deploy/start-workshop.mjs'],{cwd:root,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 assert.equal(await readFile(join(root,'.env'),'utf8'),original);
});
