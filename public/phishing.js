// A fetched email URL alone is not an open. Record only a visible landing page.
const token=new URL(location.href).searchParams.get('t');
const eventId=crypto.randomUUID();
let recorded=false;
async function reportOpen(){
 if(recorded||!token||document.visibilityState!=='visible')return;
 recorded=true;
 try{
  const response=await fetch('/api/exercise/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,eventId,claim:true}),credentials:'omit',keepalive:true});
  if(!response.ok)throw Error('Connection interrupted');
  const result=await response.json();
  document.getElementById('penalty-note').textContent=result.penalized?'Game consequence: EUR 1,000 and 3 trust for your village, once per participant. No real money is involved.':'No game penalty was applied. Your host can explain this exercise.';
 }catch{recorded=false;document.getElementById('penalty-note').textContent='The connection was interrupted. Return to the game and ask the host to check your exercise result.';}
}
document.addEventListener('visibilitychange',reportOpen);
window.addEventListener('online',reportOpen);
void reportOpen();
