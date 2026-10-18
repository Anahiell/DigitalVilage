import {randomUUID} from 'node:crypto';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function mailConfiguration(env=process.env){
 const smtp=!!(env.SMTP_EMAIL&&env.SMTP_APP_PASSWORD),resend=!!(env.RESEND_API_KEY&&env.EMAIL_FROM);
 const rehearsal=env.DEV_EMAIL_OUTBOX==='1'&&!smtp&&!resend;
 const issues=[];if(env.RESEND_API_KEY&&!env.EMAIL_FROM)issues.push('EMAIL_FROM is required for the Resend sender.');
 if((env.SMTP_EMAIL&&!env.SMTP_APP_PASSWORD)||(!env.SMTP_EMAIL&&env.SMTP_APP_PASSWORD))issues.push('Both SMTP_EMAIL and SMTP_APP_PASSWORD are required.');
 return {smtp,resend,rehearsal,real:smtp||resend,configured:smtp||resend||rehearsal,mode:resend?(smtp?'resend+smtp':'resend'):smtp?'smtp':rehearsal?'rehearsal':'unavailable',issues};
}
export function createMailer({env=process.env,record=()=>{},writeOutbox=()=>{},request=fetch,transportFactory,wait=pause}={}){
 const config=mailConfiguration(env);let transport,nextResendSlot=0;
 async function smtpTransport(){
  if(!transport){
   const factory=transportFactory||(await import('nodemailer')).default.createTransport;
   const port=Number(env.SMTP_PORT||465);
   transport=factory({host:env.SMTP_HOST||'smtp.gmail.com',port,secure:port===465,requireTLS:port!==465,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:8000,auth:{user:env.SMTP_EMAIL,pass:env.SMTP_APP_PASSWORD}});
  }
  return transport;
 }
 async function attempt(provider,job){
  if(provider==='resend'){
   const slot=Math.max(Date.now(),nextResendSlot);nextResendSlot=slot+650;
   if(slot>Date.now())await wait(slot-Date.now());
   let response;try{response=await request('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify({from:env.EMAIL_FROM,to:[job.to],subject:job.subject,text:job.body})});}catch{throw Object.assign(Error('Cannot reach email provider.'),{code:'connection_failed',retryable:true});}
   const data=await response.json().catch(()=>({}));
   if(!response.ok||!data.id)throw Object.assign(Error('Email API did not accept the message.'),{code:response.status===429?'rate_limit':response.status>=500?'provider_unavailable':'sender_or_recipient_rejected',retryable:response.status===429||response.status>=500,delay:Math.min(5000,Math.max(650,Number(response.headers.get('retry-after')||1)*1000))});
   return data.id;
  }
  const client=await smtpTransport();
  const result=await client.sendMail({from:`Digital Village <${env.SMTP_EMAIL}>`,to:job.to,subject:job.subject,text:job.body,messageId:`<${job.id}@digital-village.local>`});
  if(!result.accepted?.some(address=>String(address).toLowerCase()===job.to.toLowerCase()))throw Object.assign(Error('The recipient was not accepted.'),{code:'recipient_rejected'});
  return result.messageId||job.id;
 }
 function failureCode(error){
  if(error.code==='EAUTH'||error.responseCode===535)return 'authentication_failed';
  if(error.code==='ETIMEDOUT'||error.name==='TimeoutError')return 'connection_timeout';
  if(['ECONNECTION','ESOCKET','ECONNRESET','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','EDNS'].includes(error.code))return 'connection_failed';
  if(typeof error.code==='string'&&/^[a-z_]+$/.test(error.code))return error.code;
  return 'provider_rejected';
 }
 async function sendDetailed({id=randomUUID(),to,subject,body,kind='pin',createdAt=Date.now(),attemptOffset=0}){
  const job={id,to,subject,body,kind},startedAt=createdAt;let attempts=attemptOffset,lastCode='not_configured',retryable=false;
  record({id:job.id,to,kind,status:'sending',provider:config.mode,attempts,code:'',at:startedAt});
  if(config.rehearsal){writeOutbox(to,subject,body);record({id:job.id,to,kind,status:'rehearsal',provider:'outbox',attempts:attempts+1,code:'',at:startedAt});return {ok:true,attempts:attempts+1};}
  const providers=[...(config.resend?['resend']:[]),...(config.smtp?['smtp']:[])];
  for(const provider of providers){
   for(let n=0;n<2;n++){
    attempts++;
    let providerId;
    try{
     providerId=await attempt(provider,job);
    }catch(error){
     lastCode=failureCode(error);
     const transient=error.retryable||['ETIMEDOUT','ECONNECTION','ESOCKET','ECONNRESET','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','EDNS'].includes(error.code)||[421,450,451,452].includes(error.responseCode);
     retryable ||= !!transient;
     if(!transient||n===1)break;
     await wait(error.delay||650);
     continue;
    }
    // A local audit failure must not turn an accepted email into a permanent rejection.
    // Let the durable queue retain and recover this request with its existing key.
    record({id:job.id,to,kind,status:'accepted',provider,providerId,attempts,code:'',at:startedAt});return {ok:true,attempts,provider,providerId};
   }
  }
  record({id:job.id,to,kind,status:'failed',provider:config.mode,attempts,code:lastCode,at:startedAt});return {ok:false,attempts,code:lastCode,retryable:retryable||!providers.length};
 }
 const send=async message=>(await sendDetailed(message)).ok;
 return {config,send,sendDetailed};
}
