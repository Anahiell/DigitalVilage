import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('generated service paths have no literal quotes; systemd validates it before release activation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dv-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'deploy'));await mkdir(join(root,'runtime/current'),{recursive:true});
 for(const file of ['deploy/pi-config.mjs','mailer.js'])await copyFile(file,join(root,file));
 await writeFile(join(root,'.env'),'ADMIN_PASSWORD=unit-test-password-0123456789\nPIN_PEPPER=unit-test-pepper-0123456789012345\nDEV_EMAIL_OUTBOX=0\nSMTP_EMAIL=unit@example.invalid\nSMTP_APP_PASSWORD=synthetic-password\nPRIVACY_CONTACT=unit@example.invalid\nPUBLIC_BASE_URL=https://game.example.invalid\n');
 const result=spawnSync(process.execPath,['deploy/pi-config.mjs','--unit','--user','robot'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const path=join(root,'runtime/digital-village.service'),unit=await readFile(path,'utf8');
 assert.equal(unit.match(/^WorkingDirectory=(.*)$/m)[1],join(root,'runtime/current'));
 assert.ok(!unit.match(/^WorkingDirectory=(.*)$/m)[1].startsWith('"'));
 assert.equal(unit.match(/^EnvironmentFile=(.*)$/m)[1],join(root,'.env'));
 assert.match(unit,/^ExecStart="/m);
 if(process.platform==='linux'){
  const verify=spawnSync('systemd-analyze',['verify',path],{encoding:'utf8'});
  assert.equal(verify.status,0,verify.stderr||String(verify.error));
  assert.equal(verify.stderr.trim(),'','systemd warnings can silently ignore required settings');
 }
 const launcher=await readFile('deploy/pi-launch.sh','utf8');
 const verification=launcher.indexOf('systemd-analyze verify');assert.ok(verification>=0);
 assert.ok(verification<launcher.indexOf('ln -sfn "$APP_RELEASE"'));
 assert.ok(verification<launcher.indexOf('sudo install -m 644'));
});
