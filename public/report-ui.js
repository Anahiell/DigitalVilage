const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>Math.round(value||0).toLocaleString('en-US');
const money=value=>'€'+num(value);

// Reconcile existing nodes rather than replacing the screen on every poll.
// Stable details, forms and cards retain focus, selection and scroll position.
export function updateScreen(root,html){
 const template=document.createElement('template');template.innerHTML=html;
 const key=n=>n.nodeType===1&&(n.id||n.dataset.domKey||n.dataset.key||n.dataset.taskId||n.dataset.screen||n.dataset.action&&`${n.dataset.action}:${n.dataset.id||''}:${n.dataset.answer||''}`||n.dataset.view&&`view:${n.dataset.view}`);
 const same=(a,b)=>a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName)&&key(a)===key(b);
 function patch(old,next){
  if(old.nodeType===3){if(old.data!==next.data)old.data=next.data;return;}
  if(old.nodeType!==1)return;
  const focused=old===document.activeElement,details=old.tagName==='DETAILS';
  const priorNumber=old.getAttribute('data-number');
  for(const a of [...old.attributes])if(!next.hasAttribute(a.name)&&!(details&&a.name==='open')&&!(focused&&a.name==='value'))old.removeAttribute(a.name);
  for(const a of next.attributes)if(!(details&&a.name==='open')&&!(focused&&a.name==='value')&&old.getAttribute(a.name)!==a.value)old.setAttribute(a.name,a.value);
  if(old.tagName==='INPUT'){if(!focused&&next.hasAttribute('value')&&old.value!==next.value)old.value=next.value;if(next.type==='checkbox')old.checked=next.checked;return;}
  if(old.tagName==='TEXTAREA'){if(!focused&&old.value!==next.value)old.value=next.value;return;}
  if(focused&&old.tagName==='SELECT')return;
  if(next.hasAttribute('data-number')&&priorNumber!==null&&priorNumber!==next.getAttribute('data-number')){
   animateNumber(old,Number(priorNumber),Number(next.getAttribute('data-number')),next.getAttribute('data-format'));return;
  }
  children(old,next);
  if(old.tagName==='SELECT')old.value=next.value;
 }
 function children(parent,next){
  let cursor=parent.firstChild;
  for(const desired of [...next.childNodes]){
   let match=cursor&&same(cursor,desired)?cursor:null;
   if(!match)for(let candidate=cursor;candidate;candidate=candidate.nextSibling)if(same(candidate,desired)){match=candidate;break;}
   if(match){if(match!==cursor)parent.insertBefore(match,cursor);patch(match,desired);cursor=match.nextSibling;}
   else {parent.insertBefore(desired.cloneNode(true),cursor);}
  }
  while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
 }
 children(root,template.content);
}
const numberAnimations=new WeakMap();
function animateNumber(node,from,to,format){
 const previous=numberAnimations.get(node);if(previous)cancelAnimationFrame(previous);
 const text=n=>(format==='money'?'€':'')+Math.round(n).toLocaleString('en-US')+(format==='percent'?'%':'');
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){node.textContent=text(to);return;}
 const start=performance.now();function step(now){if(!node.isConnected)return;const p=Math.min(1,(now-start)/450);node.textContent=text(from+(to-from)*(1-(1-p)**3));if(p<1)numberAnimations.set(node,requestAnimationFrame(step));else numberAnimations.delete(node);}numberAnimations.set(node,requestAnimationFrame(step));
}
const change=value=>value==null?'—':`${value>=0?'+':''}${Number(value.toFixed(1)).toLocaleString('en-US')}`;
export function renderRoundReport(report,{villageId,compact=false,overallStory=''}={}){
 if(!report)return '<section class="tile panel"><h2>No saved round report yet</h2><p class="muted">Reports appear when a round closes. The current round is still open.</p></section>';
 const village=report.villages.find(v=>v.id===villageId)||report.villages[0];
 const d=village.decisions;
 const activity=report.round===1?`<h3>Development decisions</h3><p>${d.projects.length?d.projects.map(p=>esc(p.name)).join(' · '):'No projects completed'}</p><p>${d.crisisLoss===null?'Funding crisis did not occur in this round.':`Funding crisis: ${money(d.crisisLoss)} removed.`}</p>`:
 report.round===2?`<h3>News decisions</h3><p>${d.news.correct} verified · ${d.news.false} fabricated · ${d.news.selected}/6 shared</p><ul>${d.news.articles.map(a=>`<li class="${a.authentic?'green-text':'red-text'}">${a.authentic?'✓':'✕'} ${esc(a.headline)}</li>`).join('')}</ul>`:
 report.round===3?`<h3>Tourism campaign</h3><p>${d.campaign?esc(d.campaign.title):'No campaign was published.'}</p>${d.campaign?`<ul>${(d.campaign.assets||[]).map(a=>`<li class="${a.permitted?'green-text':'red-text'}">${a.permitted?'✓':'✕'} ${esc(a.label)} — ${esc(a.reason)}</li>`).join('')}</ul>`:''}`:
 report.round===4?`<h3>Festival outcome</h3><p>${d.tasks.standardDone}/4 standard · ${d.tasks.urgentDone}/2 urgent completed</p><ul>${d.tasks.items.map(task=>`<li>${task.done?'✓':'○'} ${esc(task.title)} · ${task.progress}%${task.owner?' · '+esc(task.owner):' · unassigned'}</li>`).join('')}</ul>`:
 `<h3>Security decisions</h3><p>${d.security.correct}/${d.security.answered} submitted responses correct. ${d.security.answered}/${d.security.possible} possible responses submitted.</p>`;
 return `<section class="round-report ${compact?'compact-report':''}" aria-label="Saved round ${report.round} report"><header class="report-heading"><span class="eyebrow">ROUND ${report.round} COMPLETE · SAVED RESULTS</span><h2>${esc(report.name)}</h2><p>These values were frozen when this round ended. Played ${Math.floor(report.elapsedMs/60000)}m ${Math.floor(report.elapsedMs/1000)%60}s.</p></header><div class="tile panel report-comparison"><div class="results-scroll"><table class="results-table"><caption>Each village: final values and change during this round. Scroll sideways on a phone for all indicators.</caption><thead><tr><th scope="col">Village</th><th scope="col">Youth</th><th scope="col">Budget</th><th scope="col">Trust</th><th scope="col">Internet / education / services / jobs</th></tr></thead><tbody>${report.villages.map(v=>`<tr><th scope="row">${v.emoji} ${esc(v.name)}</th><td>${num(v.stats.youth)} <small>(${change(v.delta?.youth)})</small></td><td>${money(v.stats.budget)} <small>(${change(v.delta?.budget)})</small></td><td>${num(v.stats.trust)}/100 <small>(${change(v.delta?.trust)})</small></td><td>${num(v.stats.internet)} / ${num(v.stats.education)} / ${num(v.stats.services)} / ${num(v.stats.jobs)}<small>(${change(v.delta?.internet)} / ${change(v.delta?.education)} / ${change(v.delta?.services)} / ${change(v.delta?.jobs)})</small></td></tr>`).join('')}</tbody></table></div></div><div class="report-villages" aria-label="Village report">${report.villages.map(v=>`<button class="${v.id===village.id?'primary':'secondary'}" data-action="report-village" data-id="${esc(v.id)}" aria-pressed="${v.id===village.id}">${v.emoji} ${esc(v.name)}</button>`).join('')}</div><article class="tile panel village-story"><span class="eyebrow">THE STORY OF ${esc(village.name.toUpperCase())}</span><h3>${village.emoji} ${esc(village.name)} — round ${report.round}</h3>${overallStory?`<p class="workshop-story"><b>The whole workshop.</b> ${esc(overallStory)}</p>`:''}<p class="story-text">${esc(village.story)}</p><div class="report-detail-grid"><section class="report-decisions">${activity}</section><section><h3>The village council</h3><ul class="report-team">${village.team.length?village.team.map(p=>`<li><b>${esc(p.name)}</b><span>${esc(p.position)}${p.verified?'':' · did not sign in'}</span></li>`).join(''):'<li>No council members were registered.</li>'}</ul></section></div>${village.incidents.length?`<details data-key="incidents-${report.round}-${village.id}"><summary>Incidents during the round (${village.incidents.length})</summary><ul>${village.incidents.map(i=>`<li><b>${esc(i.title)}</b> — ${esc(i.details)}</li>`).join('')}</ul></details>`:''}</article></section>`;
}
export function renderNewsSources(sources=[]){
 if(!sources.length)return '';
 return `<details class="tile panel source-records" data-key="news-sources"><summary>Official village bulletins — check the facts, signer and seal</summary><p class="fineprint">These records were frozen after the development round. Compare a report with the record for its village; a copied seal alone is not proof.</p><div class="source-grid">${sources.map(s=>`<article><h4>${esc(s.name)}</h4><p>Signed by <b>${esc(s.signer)}</b><br>Seal <b>${esc(s.seal)}</b></p><dl><dt>Budget</dt><dd>${money(s.stats.budget)}</dd><dt>Young residents</dt><dd>${num(s.stats.youth)}</dd><dt>Trust</dt><dd>${num(s.stats.trust)}/100</dd><dt>Internet</dt><dd>${num(s.stats.internet)}/100</dd><dt>Employment</dt><dd>${num(s.stats.jobs)}/100</dd></dl><p>Projects: ${s.projects.length?s.projects.map(esc).join(', '):'None completed'}</p></article>`).join('')}</div></details>`;
}
export function renderSecurityExercise(state){
 const answers=new Map((state.securityAnswers||[]).map(a=>[a.question_id,a.answer_id]));
 const open=state.game.round===5&&state.game.phase==='playing'&&!!state.me;
 return `<section class="tile panel security-exercise"><div class="section-title"><div><span class="eyebrow">PRACTISE THE DECISION</span><h3>Four messages. What would you do?</h3></div><span class="pill">${answers.size}/4 SAVED</span></div><p class="muted">Choose the safest response. You can change it while the round is open; explanations appear when the host closes the round. This activity works even if the exercise email does not arrive.</p><div class="security-question-grid">${(state.securityQuestions||[]).map((q,i)=>`<fieldset class="security-question"><legend>${i+1}. ${esc(q.title)}</legend><p>${esc(q.message)}</p><div class="security-options">${q.options.map(option=>`<button type="button" class="secondary ${answers.get(q.id)===option.id?'answer-selected':''}" data-action="answer-security" data-id="${esc(q.id)}" data-answer="${esc(option.id)}" aria-pressed="${answers.get(q.id)===option.id}" ${open?'':'disabled'}>${answers.get(q.id)===option.id?'✓ ':''}${esc(option.text)}</button>`).join('')}</div>${q.correct?`<p class="answer-explanation ${answers.get(q.id)===q.correct?'green-text':'red-text'}">${answers.has(q.id)?answers.get(q.id)===q.correct?'✓ Correct response. ':'Review your response. ':'No response submitted. '}${esc(q.explanation)}</p>`:''}</fieldset>`).join('')}</div></section>`;
}

export function renderHostSupport(state,draft,testEmail,testSender='pin'){
 const available=state.slots.filter(p=>p.village===draft.village).map(p=>p.role);
 const roles=state.roles.filter(role=>!available.includes(role.id));
 const exercise=state.mailConfiguration?.exercise;
 const ready=testSender==='exercise'?exercise?.real:state.mailConfiguration?.real;
 const exerciseLabel=exercise?.requested?(exercise.real?(exercise.separate?'separate account':'same account as PIN delivery'):'unavailable; separate sender settings are incomplete'):'shared with PIN delivery';
 return `<div class="host-support-grid"><section class="tile panel"><span class="eyebrow">EMAIL READINESS</span><h3>Verify a real delivery</h3><p class="muted">Sender mode: <b>${esc(state.emailMode)}</b>. Provider acceptance is recorded below; check the actual inbox before opening registration.</p>${(state.mailConfiguration?.issues||[]).map(issue=>`<p class="red-text">${esc(issue)}</p>`).join('')}<p class="muted mail-queue-status"><b>${state.mailQueue?.pending||0} saved request(s) awaiting completion.</b> Queued requests survive restart and retry for up to 15 minutes. Accepted means the provider accepted the message; confirm receipt in the actual inbox.</p><p class="muted">Exercise sender: <b>${esc(exerciseLabel)}</b></p><form id="mail-test-form" class="form-stack"><label>Sender to test<select name="sender"><option value="pin" ${testSender==='pin'?'selected':''}>PIN delivery</option><option value="exercise" ${testSender==='exercise'?'selected':''}>Security exercise</option></select></label><label>Address you will check<input type="email" name="email" autocomplete="email" required value="${esc(testEmail)}"></label><button class="secondary" type="submit" ${ready?'':'disabled'}>Send one delivery test</button></form><div class="delivery-status" role="status"></div><ul class="mail-diagnostics">${(state.mailDeliveries||[]).map(m=>`<li><b>${esc(m.status)}</b> · ${esc(m.provider)} · ${esc(m.email)}<small>${esc(m.kind)} · ${m.attempts} attempt(s)${m.error_code?' · '+esc(m.error_code):''}</small></li>`).join('')||'<li>No delivery attempts recorded yet.</li>'}</ul></section><section class="tile panel"><span class="eyebrow">RESERVE ENTRY ROUTE</span><h3>Enrol a participant in person</h3><p class="muted">If email is blocked, verify the person in front of you and hand over a private PIN. This creates a real game account without sending an email.</p><form id="enrol-form" class="form-stack"><label>Name<input name="name" minlength="2" maxlength="70" required autocomplete="name" value="${esc(draft.name)}"></label><label>Account email<input name="email" type="email" maxlength="150" required autocomplete="email" value="${esc(draft.email)}"></label><label>Village<select name="village" id="enrol-village">${state.villages.map(v=>`<option value="${v.id}" ${draft.village===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><label>Role<select name="role" required ${roles.length?'':'disabled'}>${roles.length?roles.map(r=>`<option value="${r.id}" ${draft.role===r.id?'selected':''}>${esc(r.label)}</option>`).join(''):'<option value="">Village is full</option>'}</select></label><label class="checkline"><input type="checkbox" name="present" required ${draft.present?'checked':''}><span>The participant is present and I have checked their identity.</span></label><p class="fineprint">Every enrolled participant receives the workshop phishing exercise and a final personal report.</p><button class="primary" type="submit" ${roles.length?'':'disabled'}>Create account & show private PIN</button></form></section></div>`;
}

export function renderFinalReport(report){
 if(!report)return '';
 const last=report.rounds.at(-1),village=last?.villages.find(v=>v.id===report.player.villageId);
 return `<section class="tile panel final-report"><h2>Final village report</h2><p><b>${esc(report.player.name)}</b> · ${esc(report.player.role)}</p>${village?`<h3>${esc(village.name)}</h3><p>${esc(village.story)}</p><ul>${village.team.map(p=>`<li>${esc(p.name)} — ${esc(p.position)}</li>`).join('')}</ul><p>Budget ${money(village.stats.budget)} · Youth ${num(village.stats.youth)} · Trust ${num(village.stats.trust)}</p>`:''}${report.rounds.map(r=>renderRoundReport(r,{villageId:report.player.villageId})).join('')}</section>`;
}

export function renderParticipants(state){
 const people=state.participants||[],roundFive=state.game.round===5&&['playing','paused','review'].includes(state.game.phase);
 const time=value=>value?new Date(value).toLocaleTimeString('en-GB'):'—';
 return `<div class="page-head"><span class="eyebrow">HOST ONLY · LIVE PARTICIPANT MONITOR</span><h1>Participants & readiness</h1><p>Updates automatically. Online means a signed-in account was seen within 35 seconds. Ready is confirmed by the participant.</p></div><section class="tile panel"><p role="status">${people.length} registered · ${people.filter(p=>p.signedIn).length} signed in · ${people.filter(p=>p.online).length} online · ${people.filter(p=>p.ready).length} ready · ${people.filter(p=>p.first_opened_at).length} exercise links opened</p><div class="results-scroll"><table class="results-table"><caption>Participant accounts, readiness and round-five exercise delivery</caption><thead><tr><th scope="col">Participant</th><th scope="col">Village / role</th><th scope="col">Account</th><th scope="col">Ready</th><th scope="col">Exercise email</th><th scope="col">Exercise link</th><th scope="col">Support</th></tr></thead><tbody>${people.map(p=>`<tr><th scope="row">${esc(p.name)}<small>${esc(p.email)}</small></th><td>${esc(state.villages.find(v=>v.id===p.village_id)?.name)}<small>${esc(state.roles.find(r=>r.id===p.role)?.label||p.role)}</small></td><td>${p.online?'Online':p.signedIn?'Signed in · offline':p.verified?'Signed out':'Not signed in yet'}<small>Last seen: ${time(p.last_seen)}</small></td><td>${p.ready?'Ready':'Not ready'}</td><td>${esc(p.delivery_status||'Not sent')}<small>${p.send_count} request(s)${p.error_code?' · '+esc(p.error_code):''}</small></td><td>${p.first_opened_at?`Opened ${time(p.first_opened_at)}<small>${p.open_count} page open(s) · last ${time(p.last_opened_at)}</small>`:'Not opened'}</td><td><button class="secondary small" data-action="resend-exercise" data-id="${esc(p.id)}" ${roundFive&&p.canResend?'':'disabled'}>${p.pending?'Queued / sending':p.canResend?'Resend exercise':'Wait 90 seconds'}</button><button class="ghost small" data-action="issue-pin" data-id="${esc(p.id)}">Rescue PIN</button></td></tr>`).join('')||'<tr><td colspan="7">No registered participants yet.</td></tr>'}</tbody></table></div><p class="fineprint">Accepted means the provider accepted the email; it does not prove inbox delivery. Link opens are recorded when the reveal page is visible, without collecting passwords or storing IP addresses or device details. Automated email security checks can sometimes open pages too. Resend is limited to one request per participant every 90 seconds and is unavailable while a previous request is pending.</p></section>`;
}
