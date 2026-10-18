import {randomBytes,randomInt} from 'node:crypto';
import {INVESTMENTS,ROLES,ROUNDS,SECURITY_QUESTIONS,MEDIA_ASSETS} from './data.js';
export const STAT_KEYS=['budget','youth','internet','education','services','jobs','trust'];
export const metricSnapshot=v=>Object.fromEntries(STAT_KEYS.map(key=>[key,Number(Number(v[key]).toFixed(2))]));
const amount=value=>'€'+Math.round(value).toLocaleString('en-US');
const signed=value=>(value>=0?'+':'')+Number(value.toFixed(1));

export function campaignReview(post){
 const ids=JSON.parse(post.asset_ids),credit=String(post.credits||'').trim().toLowerCase().replace(/\s+/g,' ');
 return ids.map(id=>{const asset=MEDIA_ASSETS.find(a=>a.id===id);const credited=!asset?.requiresCredit||credit.includes(String(asset.credit).toLowerCase());const permitted=!!asset?.allowed&&credited;return {id,label:asset?.label||id,permitted,reason:!asset?.allowed?'Use is not authorised in this campaign scenario.':asset.requiresCredit&&!credited?'Required attribution is missing.':'Campaign usage conditions met.'};});
}

// Facts, seals and article IDs are frozen when round two opens.
export function generateNews(villages,people,investments,asOf=Date.now()){
 const articles=[],sources=[];
 for(const v of villages){
  const mayor=people.find(p=>p.village_id===v.id&&p.role==='mayor'&&p.verified);
  const signer=mayor?.name||'Village Council',seal=v.id.slice(0,3).toUpperCase()+'-'+randomBytes(3).toString('hex').toUpperCase();
  const projects=investments.filter(i=>i.village_id===v.id).map(i=>INVESTMENTS.find(x=>x.id===i.investment_id)?.name).filter(Boolean);
  const stats=metricSnapshot(v);
  sources.push({villageId:v.id,name:v.name,signer,seal,asOf,stats,projects});
  const facts=[
   {headline:`${v.name} publishes its remaining development budget`,body:`The council's closing bulletin records ${amount(v.budget)} in available funds.`,explanation:`The official closing budget is ${amount(v.budget)}.`},
   {headline:`Youth population count released in ${v.name}`,body:`The municipal bulletin records ${Math.round(v.youth)} young residents.`,explanation:`The official count is ${Math.round(v.youth)} young residents.`},
   {headline:`${v.name} reports its digital connectivity level`,body:`Internet connectivity stands at ${Math.round(v.internet)} out of 100 in the closing development report.`,explanation:`The official internet indicator is ${Math.round(v.internet)}/100.`},
   {headline:`${v.name} reviews its completed investments`,body:projects.length?`The council confirms ${projects.length} completed project(s): ${projects.join(', ')}.`:'The council confirms that no investment project has yet been completed.',explanation:projects.length?`The investment register lists ${projects.join(', ')}.`:'The investment register contains no completed projects.'},
   {headline:`Public trust survey completed in ${v.name}`,body:`The closing bulletin reports public trust at ${Math.round(v.trust)} out of 100.`,explanation:`The official trust indicator is ${Math.round(v.trust)}/100.`},
   {headline:`Employment bulletin issued by ${v.name}`,body:`The village employment indicator is ${Math.round(v.jobs)} out of 100 in the development report.`,explanation:`The official employment indicator is ${Math.round(v.jobs)}/100.`}
  ];
  // Fisher-Yates chooses a different mix without changing the underlying facts.
  for(let i=facts.length-1;i>0;i--){const j=randomInt(i+1);[facts[i],facts[j]]=[facts[j],facts[i]];}
  const falseBudget=Math.round(v.budget)+Math.max(3500,Math.round(v.budget*.23));
  const falseTrust=Math.round(v.trust)>80?Math.round(v.trust)-19:Math.round(v.trust)+17;
  const falseYouth=Math.round(v.youth)+randomInt(12,28);
  const fabrications=[
   {headline:`Additional funds reported in ${v.name}`,body:`A circulating report puts the council's available funds at ${amount(falseBudget)}.`,signer,seal,explanation:`The report copies a valid seal, but its amount is wrong: the official bulletin records ${amount(v.budget)}, not ${amount(falseBudget)}.`},
   {headline:`New trust survey circulates in ${v.name}`,body:`A message claims public trust has reached ${falseTrust} out of 100.`,signer:'Regional Press Liaison',seal,explanation:`The claimed ${falseTrust}/100 contradicts the official ${Math.round(v.trust)}/100. The signer also does not match the village bulletin.`},
   {headline:`Youth population revised in ${v.name}`,body:`A shared notice says ${falseYouth} young residents now live in the village.`,signer,seal:seal+'-OLD',explanation:`The bulletin records ${Math.round(v.youth)} residents, not ${falseYouth}; the notice uses an invalid old seal.`}
  ];
  const selected=[...facts.slice(0,4).map(f=>({...f,authentic:true,signer,seal})),...fabrications.map(f=>({...f,authentic:false}))];
  for(const item of selected)articles.push({...item,id:v.id+'-'+randomBytes(6).toString('hex'),sourceVillage:v.id,asOf});
 }
 for(let i=articles.length-1;i>0;i--){const j=randomInt(i+1);[articles[i],articles[j]]=[articles[j],articles[i]];}
 return {articles,sources};
}

export function buildRoundReport({round,startedAt,closedAt,elapsedMs,reason,starts,villages,people,events,investments,news,choices,posts,tasks,answers,crisisLosses}){
 const report={round,name:ROUNDS[round-1].name,startedAt,closedAt,elapsedMs,durationMs:ROUNDS[round-1].duration*1000,reason,villages:[]};
 for(const v of villages){
  const start=starts.find(x=>x.id===v.id),stats=metricSnapshot(v);
  const delta=start?Object.fromEntries(STAT_KEYS.map(k=>[k,Number((stats[k]-start[k]).toFixed(2))])):null;
  const team=people.filter(p=>p.village_id===v.id).map(p=>({id:p.id,name:p.name,role:p.role,position:ROLES.find(r=>r.id===p.role)?.label||p.role,verified:!!p.verified})).sort((a,b)=>ROLES.findIndex(r=>r.id===a.role)-ROLES.findIndex(r=>r.id===b.role));
  const localEvents=events.filter(e=>e.village_id===v.id||!e.village_id);
  const localInvestments=investments.filter(i=>i.village_id===v.id).map(i=>INVESTMENTS.find(x=>x.id===i.investment_id)).filter(Boolean);
  const chosen=choices.filter(c=>c.village_id===v.id).map(c=>news.find(n=>n.id===c.news_id)).filter(Boolean);
  const post=posts.find(p=>p.village_id===v.id),localTasks=tasks.filter(t=>t.village_id===v.id);
  const participantIds=new Set(team.filter(p=>p.verified).map(p=>p.id));
  const localAnswers=answers.filter(a=>participantIds.has(a.player_id));
  const correct=localAnswers.filter(a=>SECURITY_QUESTIONS.find(q=>q.id===a.question_id)?.correct===a.answer_id).length;
  const decisions={projects:localInvestments.map(i=>({id:i.id,name:i.name})),crisisLoss:crisisLosses.find(x=>x.village_id===v.id)?.amount??null,news:{selected:chosen.length,correct:chosen.filter(n=>n.authentic).length,false:chosen.filter(n=>!n.authentic).length,articles:chosen.map(n=>({id:n.id,headline:n.headline,authentic:!!n.authentic}))},campaign:post?{title:post.title,assetIds:JSON.parse(post.asset_ids),credits:post.credits||'',assets:campaignReview(post)}:null,tasks:{total:localTasks.length,done:localTasks.filter(t=>t.done).length,standardDone:localTasks.filter(t=>t.type==='blue'&&t.done).length,urgentDone:localTasks.filter(t=>t.type==='red'&&t.done).length,urgentTotal:localTasks.filter(t=>t.type==='red').length,items:localTasks.map(t=>({title:t.title,done:!!t.done,progress:Math.round(t.progress),owner:team.find(p=>p.id===t.assigned_to)?.name||null}))},security:{answered:localAnswers.length,correct,possible:participantIds.size*SECURITY_QUESTIONS.length}};
  const mayor=team.find(p=>p.role==='mayor'&&p.verified),story=[];
  story.push(mayor?`${v.name}'s council was led by Mayor ${mayor.name}, with ${team.filter(p=>p.verified).length} participating council member(s).`:`${v.name} had ${team.filter(p=>p.verified).length} participating council member(s); no verified mayor was recorded.`);
  if(delta){
   story.push(delta.youth>0.5?`Young residents increased from ${Math.round(start.youth)} to ${Math.round(stats.youth)} (${signed(delta.youth)}).`:delta.youth<-.5?`Young residents fell from ${Math.round(start.youth)} to ${Math.round(stats.youth)} (${signed(delta.youth)}).`:`The village held its youth population close to ${Math.round(stats.youth)} residents.`);
   story.push(`The round closed with ${amount(stats.budget)} (${signed(delta.budget)} euros this round) and trust at ${Math.round(stats.trust)}/100 (${signed(delta.trust)} points).`);
  }else story.push(`The village closed with ${Math.round(stats.youth)} young residents, ${amount(stats.budget)} and trust at ${Math.round(stats.trust)}/100. A starting snapshot was not available.`);
  if(round===1){story.push(localInvestments.length?`The council completed ${localInvestments.map(i=>i.name).join(', ')}.`:'No investment was completed during the development round.');if(decisions.crisisLoss!==null)story.push(`The regional funding crisis removed ${amount(decisions.crisisLoss)} from the village's budget.`);}
  if(round===2)story.push(chosen.length?`The village shared ${decisions.news.correct} verified report(s) and ${decisions.news.false} fabricated report(s); these choices affected youth and public trust.`:'The council shared no reports, so no news-choice reward or penalty was applied.');
  if(round===3){const verdict=localEvents.find(e=>e.kind==='media');story.push(post?`The tourism campaign “${post.title}” was published. ${verdict?.details||''}`:'The village did not publish a tourism campaign.');}
  if(round===4){const verdict=localEvents.find(e=>e.kind==='festival');story.push(`${decisions.tasks.standardDone}/4 standard tasks and ${decisions.tasks.urgentDone}/2 urgent tasks were completed. ${verdict?.title||'No festival outcome was recorded.'}.`);}
  if(round===5)story.push(`${correct}/${localAnswers.length} submitted security responses were correct; ${decisions.security.possible-localAnswers.length} possible response(s) were left unanswered.`);
  const incidents=localEvents.filter(e=>['random','shock','crisis'].includes(e.kind)).map(e=>({title:e.title,details:e.details}));
  report.villages.push({id:v.id,name:v.name,emoji:v.emoji,start:start?metricSnapshot(start):null,stats,delta,team,decisions,incidents,story:story.join(' ')});
 }
 return report;
}

export function buildWorkshopStories(reports){
 if(!reports.length)return [];
 const first=reports[0],last=reports.at(-1);
 return last.villages.map(v=>{
  const initial=first.villages.find(x=>x.id===v.id)?.start;
  const sentence=[initial?`${v.name} began with ${Math.round(initial.youth)} young residents and ${amount(initial.budget)}; it finished with ${Math.round(v.stats.youth)} residents and ${amount(v.stats.budget)}.`:`${v.name} finished with ${Math.round(v.stats.youth)} young residents and ${amount(v.stats.budget)}.`];
  const find=round=>reports.find(r=>r.round===round)?.villages.find(x=>x.id===v.id);
  const development=find(1),information=find(2),campaign=find(3),festival=find(4),security=find(5);
  if(development)sentence.push(development.decisions.projects.length?`Its council built ${development.decisions.projects.map(p=>p.name).join(', ')}.`:'The council completed no development investments.');
  if(information)sentence.push(`It circulated ${information.decisions.news.correct} verified and ${information.decisions.news.false} fabricated news report(s).`);
  if(campaign)sentence.push(campaign.decisions.campaign?`The campaign “${campaign.decisions.campaign.title}” used ${campaign.decisions.campaign.assets.filter(a=>!a.permitted).length} asset(s) outside the campaign's usage conditions.`:'No tourism campaign was published.');
  if(festival)sentence.push(`The festival team completed ${festival.decisions.tasks.done}/6 expected tasks.`);
  if(security)sentence.push(`The final safety exercise recorded ${security.decisions.security.correct}/${security.decisions.security.answered} correct submitted responses.`);
  sentence.push(`Public trust finished at ${Math.round(v.stats.trust)}/100.`);
  return {id:v.id,story:sentence.join(' ')};
 });
}
