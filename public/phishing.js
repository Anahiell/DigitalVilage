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

// Scanners and passive previews are tracked separately and cannot trigger a penalty.
document.getElementById('claim-upgrade')?.addEventListener('click',async event=>{
 const button=event.currentTarget;button.disabled=true;
 try{const response=await fetch('/api/exercise/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,eventId,claim:true}),credentials:'omit'});if(!response.ok)throw Error('Please try again.');const result=await response.json();document.getElementById('penalty-note').textContent=result.penalized?'Simulation consequence saved: EUR 1,000 and 3 trust for your village, once for your account. No real money is involved.':'No penalty applied. Penalties apply only to a valid personal claim during the active workshop security round. No real money is involved.';document.getElementById('offer').hidden=true;document.getElementById('lesson').hidden=false;}catch{button.disabled=false;button.textContent='Connection interrupted: try again';}
});
