import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,devices,expect} from '@playwright/test';
import {handlerFixture} from './handler-fixture.mjs';
import {ticketChallenge} from '../workshop.js';
test('Android owners can prepare capped, critical, bonused and reassigned tickets before the independent check',{timeout:60000},async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),cookies=[];for(const role of ['digital','finance']){const email=role+'@cap.invalid',e=await a.request('/api/admin/enrol',{name:role,email,village:'green-valley',role,present:true},a.admin);assert.equal(e.status,200);cookies.push((await a.request('/api/login',{email,pin:e.data.pin})).cookie);}
 await a.action('start',{workshopMode:true,peerCouncil:true});for(let r=1;r<4;r++){await a.action('closeRound');await a.action('next');}
 const browser=await chromium.launch();t.after(()=>browser.close());const errors=[];
 async function page(cookie){const c=await browser.newContext(devices['Pixel 7']);await c.route('**/*',async route=>{const q=route.request(),u=new URL(q.url());await route.fulfill(await a.handle(u.pathname+u.search,q.method(),q.postData()||'',q.headers()));});await c.addCookies([{name:'dv_session',value:cookie.split('=')[1],url:a.base}]);const p=await c.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));await p.goto(a.base);await p.locator('#task-filter').selectOption('all');return p;}
 const owner=await page(cookies[0]),peer=await page(cookies[1]);
 for(const scenario of ['standard','critical','bonus-and-reassignment']){
  const tasks=(await a.state(cookies[0])).tasks,task=tasks.find(t=>!t.done&&!t.assigned_to&&t.required_role==='digital'&&(scenario==='critical'?t.type==='red':t.type==='blue'));assert.ok(task);
  assert.equal((await a.action('claimTask',{id:task.id},cookies[0])).status,200);a.tick(120000);assert.equal(a.db.prepare('SELECT progress FROM tasks WHERE id=?').get(task.id).progress,80);
  if(scenario==='bonus-and-reassignment'){
   assert.equal((await a.action('solveTask',{id:task.id,answer:ticketChallenge(task).answer},cookies[0])).status,200);assert.equal(a.db.prepare('SELECT progress FROM tasks WHERE id=?').get(task.id).progress,84);
   for(const [op,cookie] of [['releaseTask',cookies[0]],['claimTask',cookies[1]],['releaseTask',cookies[1]],['claimTask',cookies[0]]])assert.equal((await a.action(op,{id:task.id},cookie)).status,200);
  }
  const ownCard=owner.locator(`[data-task-id="${task.id}"]`),peerCard=peer.locator(`[data-task-id="${task.id}"]`),prepare=ownCard.locator('[data-action=workTask]');await expect(prepare).toBeEnabled();await expect(prepare).toHaveText('Complete preparation step');await expect(peerCard.locator('[data-action=helpTask]')).toBeDisabled();
  await a.action(scenario==='critical'?'pauseCrisis':'pause');await expect(prepare).toBeDisabled();await a.action(scenario==='critical'?'resumeCrisis':'resume');await expect(prepare).toBeEnabled();
  await prepare.click();await expect(peerCard.locator('[data-action=helpTask]')).toBeEnabled();assert.equal(a.db.prepare('SELECT done FROM tasks WHERE id=?').get(task.id).done,0);await peerCard.locator('[data-action=helpTask]').click();await expect(ownCard).toContainText('Completed');assert.equal(a.db.prepare('SELECT done FROM tasks WHERE id=?').get(task.id).done,1);
 }
 assert.deepEqual(errors,[]);
});
