import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {mailConfiguration} from '../mailer.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
let env={...process.env};try{env={...env,...parseEnv(await readFile(join(root,'.env'),'utf8'))};}catch{}
const local='http://127.0.0.1:'+Number(env.PORT||3000),mail=mailConfiguration(env);
const checks=[];const note=(name,ok,detail)=>{checks.push({name,ok,detail});console.log((ok?'OK: ':'CHECK: ')+name+' — '+detail);};
async function inspect(base,label){
 try{const response=await fetch(base.replace(/\/$/,'')+'/healthz',{signal:AbortSignal.timeout(10000)});const data=await response.json();note(label,response.ok&&data.ok&&data.app==='digital-village',data.app==='digital-village'?'Digital Village responded.':'This URL is not the updated Digital Village service.');return response.ok&&data.app==='digital-village';}
 catch{note(label,false,'Cannot reach the application. Check power, network, service and route.');return false;}
}
const online=await inspect(local,'Local server');
note('Real email sender configured',mail.real,mail.mode+'; this checks settings, not inbox delivery.');
note('Public rehearsal outbox disabled',env.DEV_EMAIL_OUTBOX==='0','DEV_EMAIL_OUTBOX must be 0 on the public game.');
note('Organiser contact',!!env.PRIVACY_CONTACT&&!/example\.(org|com|net)/.test(env.PRIVACY_CONTACT),'Use a real contact before the workshop.');
if(args.includes('--public')){
 if(env.PUBLIC_BASE_URL?.startsWith('https://'))await inspect(env.PUBLIC_BASE_URL,'Public HTTPS address');else note('Public HTTPS address',false,'PUBLIC_BASE_URL is missing.');
}
if(online){
 try{
  const login=await fetch(local+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(10000)});
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  note('Host account',login.ok&&!!cookie,'Host authentication checked without printing the password.');
  if(cookie){
   const running=await (await fetch(local+'/api/state',{headers:{Cookie:cookie}})).json();
   note('Running sender matches configuration',running.emailMode===mail.mode,'Restart the service after changing sender settings.');
   let expected='';try{expected=new URL(env.PUBLIC_BASE_URL).origin+'/';}catch{}
   note('Running invitation address',!!expected&&running.invitationUrl===expected,'The QR address must match the current public origin.');
   const response=await fetch(local+'/api/invite.svg',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
   note('Invitation QR',response.ok&&response.headers.get('content-type')?.includes('image/svg+xml'),'QR uses the configured public address.');
   const mailIndex=args.indexOf('--mail');
   if(mailIndex>=0){
    const email=args[mailIndex+1];if(!email)throw Error('An explicit test recipient is required.');
    const sent=await fetch(local+'/api/admin/test-email',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({email}),signal:AbortSignal.timeout(65000)});
    const result=await sent.json();note('Requested test email',sent.ok,result.message||result.error);console.log('Check the recipient inbox/spam folder to confirm receipt.');
   }
   await fetch(local+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});
  }
 }catch(error){note('Host / QR check',false,error.message);}
}
if(checks.some(c=>!c.ok))process.exitCode=1;
