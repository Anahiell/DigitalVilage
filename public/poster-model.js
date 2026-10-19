export function normaliseLayout(value){
 if(value===undefined||value===null)return {};
 if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid poster layout.');
 const formats=['portrait','square','landscape'],themes=['forest','sunset','ocean','night'];
 if(value.format&&!formats.includes(value.format)||value.theme&&!themes.includes(value.theme))throw Error('Choose a known poster format and theme.');
 const positions={};
 if(value.positions!==undefined){if(!value.positions||typeof value.positions!=='object'||Array.isArray(value.positions)||Object.keys(value.positions).length>12)throw Error('Too many poster layers.');
  for(const [key,p] of Object.entries(value.positions)){
   if(!/^(title|body|credits|asset:[a-z0-9-]+)$/.test(key)||!p||!['x','y','scale'].every(k=>Number.isFinite(p[k]))||p.x<.04||p.x>.96||p.y<.04||p.y>.92||p.scale<.5||p.scale>1.6)throw Error('Poster layers must stay inside the canvas.');
   positions[key]={x:p.x,y:p.y,scale:p.scale};
  }
 }
 return Object.keys(value).length?{format:value.format||'portrait',theme:value.theme||'forest',positions}:{};
}
export const CAMPAIGN_BRIEF={audience:'Young people aged 18–30 visiting your village',deliverable:'A mobile social-media poster for the Youth Futures Festival',requirements:['Name the village and festival.','Give a date, time and meeting place.','Offer two activities and one reason to visit.','Include a clear call to action (join, visit or register).','Use one to five visual assets; check every usage card.','Share the exact design, have another teammate review it, then publish.'],schedule:'Writer supplies date, place and activities; designer arranges the canvas; fact checker verifies city claims; rights checker checks contracts and credit; audience tester checks readability and the call to action. Any different teammate can confirm publication.'};
