import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,devices,expect} from '@playwright/test';
import {handlerFixture} from './handler-fixture.mjs';

test('Android starts with every ticket, shows real vector logos and reveals the email exercise immediately',{timeout:60000},async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),email='clarity@example.invalid';
 const enrol=await a.request('/api/admin/enrol',{name:'Clarity',email,village:'green-valley',role:'media',present:true},a.admin);
 const cookie=(await a.request('/api/login',{email,pin:enrol.data.pin})).cookie;
 const browser=await chromium.launch();t.after(()=>browser.close());const context=await browser.newContext(devices['Pixel 7']);
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());await route.fulfill(await a.handle(u.pathname+u.search,r.method(),r.postData()||'',r.headers()));});
 await context.addCookies([{name:'dv_session',value:cookie.split('=')[1],url:a.base}]);
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await a.action('start',{workshopMode:true,peerCouncil:true});
 for(let i=1;i<3;i++){await a.action('closeRound');await a.action('next');}
 await p.goto(a.base);await expect(p.locator('.asset-art svg')).toHaveCount(18);
 await p.locator('[data-action=asset][data-id=spotify]').click();await expect(p.locator('#poster-layer')).toContainText('Spotify');
 await mkdir('test-results/clarity',{recursive:true});await p.screenshot({path:'test-results/clarity/android-studio.png',fullPage:true});
 await a.action('closeRound');await a.action('next');a.tick(120000);
 await expect(p.locator('#task-filter')).toHaveValue('all');await expect(p.locator('#task-filter option').first()).toHaveText('All tickets');
 const tasks=(await a.state(cookie)).tasks;await expect(p.locator('.task')).toHaveCount(tasks.length);
 assert.equal(await p.locator('#task-filter').evaluate(el=>!!document.querySelector('label[for="'+el.id+'"]')||!!el.closest('label')),true);
 await p.screenshot({path:'test-results/clarity/android-tickets.png',fullPage:true});
 await a.action('closeRound');await a.action('next');await expect(p.locator('details[data-key=security-fallback]')).not.toHaveAttribute('open','');
 const exercise=(await a.state(cookie)).exerciseUrl;await p.goto(new URL(exercise,a.base).href);
 await expect(p.getByRole('heading',{name:'Oops, hello! This was phishing.'})).toBeVisible();
 await expect.poll(()=>a.db.prepare('SELECT COUNT(*) n FROM exercise_penalties').get().n).toBe(1);await p.reload();await expect(p.getByRole('heading',{name:'Oops, hello! This was phishing.'})).toBeVisible();assert.equal(a.db.prepare('SELECT COUNT(*) n FROM exercise_penalties').get().n,1);assert.equal(await p.locator('input').count(),0);await p.screenshot({path:'test-results/clarity/android-reveal.png',fullPage:true});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
});
