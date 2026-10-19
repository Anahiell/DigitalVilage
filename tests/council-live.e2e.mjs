import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,devices,expect} from '@playwright/test';
import {handlerFixture} from './handler-fixture.mjs';

test('mobile council journey: briefing, stable polls, mayor approval, live metrics and vertical task board',{timeout:90000},async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const a=await handlerFixture(t,{fakeClock:true});
 const errors=[];
 async function pageFor(cookie,options={}){const c=await browser.newContext(options);await c.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());await route.fulfill(await a.handle(u.pathname+u.search,r.method(),r.postData()||'',r.headers()));});await c.addCookies([{name:'dv_session',value:cookie.split('=')[1],url:a.base}]);const p=await c.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));await p.goto(a.base);return p;}
 async function enrol(name,role){const email=role+'@ui.example.invalid',r=await a.request('/api/admin/enrol',{name,email,village:'green-valley',role,present:true},a.admin);return (await a.request('/api/login',{email,pin:r.data.pin})).cookie;}
 const mayorCookie=await enrol('Mobile Mayor','mayor'),memberCookie=await enrol('Mobile Events','events');
 const host=await pageFor(a.admin),member=await pageFor(memberCookie,devices['Pixel 7']),mayor=await pageFor(mayorCookie,devices['Pixel 7']);
 await expect(member.getByRole('heading',{name:'Before we begin'})).toBeVisible();await member.getByRole('button',{name:'I’m ready',exact:true}).click();
 await expect(member.getByText('You are ready. Waiting for the host.',{exact:false})).toBeVisible();assert.equal((await a.state()).game.round,0);
 await host.locator('[data-view=admin]').first().click();await host.getByRole('button',{name:'▶ Start the game',exact:true}).click();
 await expect(member.locator('.round-mission')).toContainText('ROUND 1 OF 5');await expect(member.getByRole('button',{name:'Propose investment'}).first()).toBeEnabled();
 a.tick(60000);await expect(member.locator('[data-action=invest][data-id=school]')).toBeVisible();const before=(await a.state()).villages[0].budget;
 await member.locator('[data-action=invest][data-id=school]').click();await expect(member.locator('[data-action=invest][data-id=school]')).toHaveText('Awaiting mayor');
 await expect(member.locator('[data-action=invest][data-id=school]')).toBeDisabled();
 assert.equal((await a.state()).builtInvestments.length,0);
 await mayor.locator('[data-view=council]').last().click();await expect(mayor.getByText(/Proposed by Mobile Events/)).toBeVisible();await mayor.getByRole('button',{name:'Approve and apply',exact:true}).click();
 await expect(member.locator('[data-action=invest][data-id=school]')).toHaveText('Completed');assert.ok((await a.state()).villages[0].budget<before);
 // The grant input and details must remain the same nodes across real polls.
 if(!await host.locator('.host-setup').evaluate(e=>e.open))await host.locator('.host-setup > summary').click();await host.locator('#grant-form input').fill('12345');await host.locator('#grant-form input').focus();
 const input=await host.locator('#grant-form input').elementHandle(),details=await host.locator('.host-setup').elementHandle();
 await expect.poll(async()=>{await a.state(memberCookie);return await input.evaluate(e=>e.isConnected&&e===document.activeElement&&e.value==='12345');}).toBe(true);
 await host.waitForTimeout(7600);
 assert.equal(await input.evaluate(e=>e.isConnected&&e===document.activeElement&&e.value==='12345'),true);assert.equal(await details.evaluate(e=>e.open),true);
 await member.locator('[data-view=home]').last().click();const stat=await member.locator('.stat strong').first().elementHandle();
 await a.action('adjustVillage',{village:'green-valley',metric:'trust',delta:5});await expect(member.locator('.stat').filter({hasText:'Public trust'})).toContainText('79%');assert.equal(await stat.evaluate(e=>e.isConnected),true);
 await a.action('closeRound');await a.action('next');await a.action('closeRound');await a.action('next');
 await expect(member.locator('#post-form')).toBeVisible();await member.locator('#post-form [name=title]').fill('Our mobile campaign');await member.locator('#post-form [name=body]').fill('Discover our community and its wonderful mountain trails.');
 await member.locator('.asset-usage summary').click();const draft=await member.locator('#post-form [name=body]').elementHandle();await draft.focus();await member.waitForTimeout(7600);
 assert.equal(await draft.evaluate(e=>e.isConnected&&e===document.activeElement&&e.value.includes('mountain trails')),true);await expect(member.locator('.asset-usage')).toHaveAttribute('open','');
 await a.action('pause');await expect(member.locator('body')).toHaveAttribute('data-phase','paused');assert.equal(await draft.evaluate(e=>e.isConnected&&e===document.activeElement),true);
 await a.action('resume');await expect(member.locator('body')).toHaveAttribute('data-phase','playing');assert.equal(await draft.evaluate(e=>e.isConnected&&e.value.includes('mountain trails')),true);
 await a.action('closeRound');await a.action('next');await expect(member.locator('.kanban')).toBeVisible();
 assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 const columns=await member.locator('.board-col').evaluateAll(es=>es.map(e=>({left:e.getBoundingClientRect().left,top:e.getBoundingClientRect().top})));assert.ok(columns.every(c=>Math.abs(c.left-columns[0].left)<2));assert.ok(columns[1].top>columns[0].top);
 await member.locator('[data-action=claimTask]').first().click();await expect(member.locator('.task-owner').filter({hasText:'Mobile Events'})).toBeVisible();
 const taskCard=await member.locator('.task').filter({hasText:'Mobile Events'}).first().elementHandle();await member.waitForTimeout(7600);assert.equal(await taskCard.evaluate(e=>e.isConnected),true);
 const dir=process.env.DV_ARTIFACTS;if(dir){await mkdir(dir,{recursive:true});await member.evaluate(()=>scrollTo(0,0));await member.screenshot({path:join(dir,'android-festival-board.png'),fullPage:true});await mayor.locator('[data-view=council]').last().click();await mayor.screenshot({path:join(dir,'mobile-council-decisions.png'),fullPage:true});}
 assert.deepEqual(errors,[]);
});
