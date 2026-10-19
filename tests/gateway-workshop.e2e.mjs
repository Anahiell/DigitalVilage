import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,devices,expect} from '@playwright/test';
import {handlerFixture} from './handler-fixture.mjs';
import {createGateway} from '../deploy/auto-domain/gateway.js';
import {ticketChallenge} from '../workshop.js';
test('Android through the Pages gateway loads all modules and plays pause, resume and ticket bonus',{timeout:45000},async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),email='gateway-phone@example.invalid',e=await a.request('/api/admin/enrol',{name:'Gateway Phone',email,village:'green-valley',role:'digital',present:true},a.admin),cookie=(await a.request('/api/login',{email,pin:e.data.pin})).cookie;
 const browser=await chromium.launch();t.after(()=>browser.close());const context=await browser.newContext(devices['Pixel 7']),errors=[];
 const gateway=createGateway(async(url,options)=>{const target=new URL(url),body=options.body?await new Response(options.body).text():'',r=await a.handle(target.pathname+target.search,options.method,body,Object.fromEntries(options.headers));return new Response(r.body,{status:r.status,headers:r.headers});});
 await context.route('**/*',async route=>{const r=route.request(),response=await gateway.fetch(new Request(r.url(),{method:r.method(),headers:r.headers(),body:r.postData()||undefined}));await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});await context.addCookies([{name:'dv_session',value:cookie.split('=')[1],url:a.base}]);const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await a.action('start',{workshopMode:true,peerCouncil:true});await p.goto(a.base);await expect(p.locator('.invest-card')).toHaveCount(1);await a.action('pause');await expect(p.locator('body')).toHaveAttribute('data-phase','paused');await a.action('resume');await expect(p.locator('body')).toHaveAttribute('data-phase','playing');
 for(let i=1;i<4;i++){await a.action('closeRound');await a.action('next');}await expect(p.locator('#task-filter')).toBeVisible();await p.locator('#task-filter').selectOption('all');const task=(await a.state(cookie)).tasks[0];await p.locator(`[data-task-id="${task.id}"] [data-action=claimTask]`).click();const card=p.locator(`[data-task-id="${task.id}"]`);await card.locator('summary').click();await card.locator(`[data-action=solveTask][data-answer="${ticketChallenge(task).answer}"]`).click();await expect(card.locator('summary')).toContainText('Bonus saved');assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
});
