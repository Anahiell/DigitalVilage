import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createWorkshopMailer} from '../mailer.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),path=join(root,'.env');
let text;try{text=await readFile(path,'utf8');}catch{text=await readFile(join(root,'.env.example'),'utf8');}
const env=parseEnv(text),args=process.argv.slice(2);
function set(key,value){const line=key+'='+JSON.stringify(String(value));const pattern=new RegExp('^'+key+'=.*$','m');text=pattern.test(text)?text.replace(pattern,line):text.trimEnd()+'\n'+line+'\n';env[key]=String(value);}
if(args.includes('--configure')){
 for(const [key,length] of [['ADMIN_PASSWORD',24],['PIN_PEPPER',32]])if(!env[key]||env[key].includes('CHANGE_ME'))set(key,randomBytes(length).toString('hex'));
 set('NODE_ENV','production');set('HOST','127.0.0.1');set('DEV_EMAIL_OUTBOX','0');
 const urlIndex=args.indexOf('--url');if(urlIndex>=0)set('PUBLIC_BASE_URL',args[urlIndex+1]||'');
 const funnelIndex=args.indexOf('--funnel-url');if(funnelIndex>=0){let keep=false;try{const existing=new URL(env.PUBLIC_BASE_URL);keep=existing.protocol==='https:'&&!existing.hostname.endsWith('.ts.net')&&!/example\.(org|com|net)$/.test(existing.hostname)&&existing.hostname!=='example';}catch{}if(!keep)set('PUBLIC_BASE_URL',args[funnelIndex+1]||'');}
 set('DB_PATH',resolve(root,env.DB_PATH||'storage/village.db'));
 if((!env.PRIVACY_CONTACT||/example\.(org|com|net)/.test(env.PRIVACY_CONTACT))&&env.SMTP_EMAIL)set('PRIVACY_CONTACT',env.SMTP_EMAIL);
 await mkdir(dirname(env.DB_PATH),{recursive:true,mode:0o700});
 const temporary=path+'.tmp-'+process.pid;await writeFile(temporary,text,{mode:0o600});await rename(temporary,path);
}
const port=Number(env.PORT||3000),errors=[];
if(!Number.isInteger(port)||port<1024||port>65535)errors.push('PORT must be an integer from 1024 to 65535.');
if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<14||env.ADMIN_PASSWORD.includes('CHANGE_ME'))errors.push('Set a strong ADMIN_PASSWORD.');
if(!env.PIN_PEPPER||env.PIN_PEPPER.length<20||env.PIN_PEPPER.includes('CHANGE_ME'))errors.push('Set a separate strong PIN_PEPPER.');
if(env.DEV_EMAIL_OUTBOX!=='0')errors.push('Public operation requires DEV_EMAIL_OUTBOX=0.');
if(!env.PRIVACY_CONTACT||/example\.(org|com|net)/.test(env.PRIVACY_CONTACT))errors.push('Set PRIVACY_CONTACT to the organiser’s real contact address.');
try{const url=new URL(env.PUBLIC_BASE_URL);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();}catch{errors.push('Set PUBLIC_BASE_URL to the exact public HTTPS origin of this game.');}
const senders=createWorkshopMailer({env}),mail=senders.config;if(!mail.real)errors.push('Configure Gmail SMTP or a verified Resend sender.');errors.push(...mail.issues);
if(senders.exerciseRequested&&!senders.exerciseConfig.real)errors.push('The separate exercise sender needs both EXERCISE_SMTP_EMAIL and EXERCISE_SMTP_APP_PASSWORD.');
const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<13))errors.push('Node.js 22.13 or newer is required.');
if(args.includes('--port')){console.log(port);process.exit(errors.some(e=>e.startsWith('PORT'))?1:0);}
if(args.includes('--unit')){
 const user=args[args.indexOf('--user')+1],node=process.execPath;
 if(!/^[a-z_][a-z0-9_-]*\$?$/.test(user||''))throw Error('Invalid service account.');
 const quote=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
 const unit=`[Unit]\nDescription=Digital Village workshop\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${user}\nWorkingDirectory=${quote(join(root,'runtime/current'))}\nEnvironmentFile=${quote(path)}\nExecStart=${quote(node)} server.js\nRestart=always\nRestartSec=5\nTimeoutStopSec=20\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=multi-user.target\n`;
 await mkdir(join(root,'runtime'),{recursive:true,mode:0o700});await writeFile(join(root,'runtime/digital-village.service'),unit,{mode:0o600});
}
if(errors.length){for(const error of errors)console.error('NEEDS ATTENTION: '+error);process.exitCode=1;}
else if(!args.includes('--unit'))console.log('Configuration ready: HTTPS address, private secrets, real sender and organiser contact are set. This does not prove inbox delivery.');
