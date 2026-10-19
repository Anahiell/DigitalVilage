import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),envPath=new URL('../.env',import.meta.url);
let source;
try{source=await readFile(envPath,'utf8');}
catch(error){
 if(error.code!=='ENOENT')throw error;
 source=await readFile(new URL('../smtp.env',import.meta.url),'utf8').catch(()=>{throw Error('Copy smtp.env.example to smtp.env and fill your SMTP account, app password, public URL and contact.');});
 if(/YOUR_|CHANGE_ME/.test(source))throw Error('Fill all YOUR_ placeholders in smtp.env before starting.');
 source+=`\nADMIN_PASSWORD=${randomBytes(24).toString('hex')}\nPIN_PEPPER=${randomBytes(32).toString('hex')}\n`;
 await writeFile(envPath,source,{flag:'wx',mode:0o600});
 console.log('Created private .env. Your generated host password is ADMIN_PASSWORD in that file.');
}
const config=parseEnv(source);
if(!config.SMTP_EMAIL||!config.SMTP_APP_PASSWORD||/YOUR_|CHANGE_ME/.test(source))throw Error('Complete the SMTP configuration before starting.');
if(!config.PUBLIC_BASE_URL?.startsWith('https://'))throw Error('Set PUBLIC_BASE_URL to your existing HTTPS game address.');
if(config.DEV_EMAIL_OUTBOX!=='0')throw Error('Set DEV_EMAIL_OUTBOX=0 for real email delivery.');
const child=spawn(process.execPath,['--env-file='+fileURLToPath(envPath),'server.js'],{cwd:root,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
