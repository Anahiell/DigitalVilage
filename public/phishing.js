// Only a visible page reports an open. Fetching the email URL alone is not a click.
const token=new URL(location.href).searchParams.get('t');
const eventId=crypto.randomUUID();
let recorded=false;
function reportOpen(){
 if(recorded||!token||document.visibilityState!=='visible')return;
 recorded=true;
 const body=JSON.stringify({token,eventId});
 const send=()=>fetch('/api/exercise/open',{method:'POST',headers:{'Content-Type':'application/json'},body,credentials:'omit',keepalive:true}).then(response=>{if(!response.ok)recorded=false;}).catch(()=>{recorded=false;});
 void send();
}
document.addEventListener('visibilitychange',reportOpen);
window.addEventListener('online',reportOpen);
reportOpen();
