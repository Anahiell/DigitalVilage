// Cloudflare Pages advanced mode. Only the gateway runs here; SQLite and the game stay on the Pi.
const DEFAULT_PI_ORIGIN='https://ide-recycling-alien-roll.trycloudflare.com';
const staticPaths=new Set(['/','/index.html','/app.js','/report-ui.js','/phishing','/phishing.html','/phishing.js','/style.css','/favicon.svg','/healthz']);
const failure=(status,message)=>new Response(JSON.stringify({error:message}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow',...(status===503?{'Retry-After':'5'}:{})}});

function piOrigin(value){
 const url=new URL(value);
 const tailscale=url.hostname.endsWith('.ts.net')&&['','8443','10000'].includes(url.port);
 const quickTunnel=/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(url.hostname)&&url.port==='';
 if(url.protocol!=='https:'||!(tailscale||quickTunnel)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid Pi origin.');
 return url;
}

// Injected fetch is used by isolated tests; production always uses the platform fetch.
export function createGateway(upstreamFetch=fetch){
 return {async fetch(request,env={}){
  if(!['GET','HEAD','POST'].includes(request.method))return failure(405,'Method not allowed.');
  const incoming=new URL(request.url);
  if(!staticPaths.has(incoming.pathname)&&!incoming.pathname.startsWith('/api/'))return failure(404,'Not found.');
  let target;try{target=piOrigin(env.PI_ORIGIN||DEFAULT_PI_ORIGIN);}catch{return failure(503,'The game gateway needs a valid HTTPS Pi tunnel address.');}
  const backendOrigin=target.origin;
  // Assign the path rather than resolving user input as a URL: it cannot select another host.
  target.pathname=incoming.pathname;target.search=incoming.search;
  const headers=new Headers(request.headers);
  for(const name of ['host','connection','transfer-encoding','content-length','x-forwarded-for','x-forwarded-host','x-forwarded-proto'])headers.delete(name);
  headers.set('X-Forwarded-Proto','https');headers.set('X-Forwarded-Host',incoming.host);
  try{
   const upstream=await upstreamFetch(target.href,{method:request.method,headers,body:request.method==='POST'?request.body:undefined,duplex:'half',redirect:'manual',signal:AbortSignal.timeout(25000)});
   const responseHeaders=new Headers(upstream.headers);
   const redirect=responseHeaders.get('Location');
   if(redirect){const destination=new URL(redirect,target);if(destination.origin!==backendOrigin)return failure(502,'The game returned an unexpected redirect.');responseHeaders.set('Location',incoming.origin+destination.pathname+destination.search+destination.hash);}
   // Sessions, registration and reports must never be shared through an edge cache.
   responseHeaders.set('Cache-Control','private, no-store');
   responseHeaders.set('X-Robots-Tag','noindex, nofollow');
   return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
  }catch{return failure(503,'The Raspberry Pi is not reachable. Check its power, Internet and Tailscale Funnel, then try again.');}
 }};
}
export default createGateway();


