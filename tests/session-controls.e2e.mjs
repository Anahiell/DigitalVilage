import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,devices,expect} from '@playwright/test';
import {handlerFixture} from './handler-fixture.mjs';

test('browser: global pause/resume, player explanation, permanent end, final OK and guarded reset',{timeout:60000},async t=>{
 const a=await handlerFixture(t),browser=await chromium.launch({timeout:15000});t.after(()=>browser.close());
 async function context(options={}){
  const context=await browser.newContext(options);
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   await route.fulfill(await a.handle(url.pathname+url.search,request.method(),request.postData()||'',request.headers()));
  });return context;
 }
 const hostContext=await context(),playerContext=await context(devices['Pixel 7']);
 const account=await a.request('/api/admin/enrol',{name:'Mobile Mayor',email:'mobile@example.invalid',village:'green-valley',role:'mayor',present:true},a.admin);
 const login=await a.request('/api/login',{email:'mobile@example.invalid',pin:account.data.pin});
 await hostContext.addCookies([{name:'dv_session',value:a.admin.split('=')[1],url:a.base}]);
 await playerContext.addCookies([{name:'dv_session',value:login.cookie.split('=')[1],url:a.base}]);
 const host=await hostContext.newPage(),player=await playerContext.newPage(),errors=[];
 for(const page of [host,player]){page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));}
 await host.goto(a.base);await host.locator('[data-view=admin]').first().click();await player.goto(a.base);
 await host.getByRole('button',{name:'▶ Start the game',exact:true}).click();
 await host.getByRole('button',{name:'Ⅱ Pause game',exact:true}).click();
 await expect(host.locator('#session-status')).toContainText('The host paused the entire game');
 await expect(host.getByRole('button',{name:'▶ Resume game',exact:true})).toBeVisible();
 await expect(host.locator('[data-action=shock]')).toHaveCount(0);
 await expect(host.locator('#grant-form button')).toBeDisabled();
 await player.reload();await expect(player.getByText(/The host paused the entire game/)).toBeVisible();
 assert.ok(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile screen must not overflow horizontally');
 const artifactDir=process.env.DV_ARTIFACTS;
 if(artifactDir){await mkdir(artifactDir,{recursive:true});await host.locator('.home-grid > section').first().screenshot({path:join(artifactDir,'session-paused.png')});}
 await host.getByRole('button',{name:'▶ Resume game',exact:true}).click();
 await expect(host.getByRole('button',{name:'Ⅱ Pause game',exact:true})).toBeVisible();assert.equal((await a.state()).game.phase,'playing');
 host.once('dialog',async d=>{assert.match(d.message(),/cannot be resumed/);await d.dismiss();});
 await host.getByRole('button',{name:'End session permanently',exact:true}).click();assert.equal((await a.state()).game.phase,'playing');
 host.once('dialog',d=>d.accept());await host.getByRole('button',{name:'End session permanently',exact:true}).click();
 await expect(host.locator('#session-status')).toContainText('This is not a pause');
 await expect(host.locator('[data-action=resume]')).toHaveCount(0);
 await expect(host.getByRole('button',{name:'Open final round reports',exact:true})).toBeVisible();
 if(artifactDir)await host.locator('.home-grid > section').first().screenshot({path:join(artifactDir,'session-ended.png')});
 await player.reload();const dialog=player.getByRole('dialog',{name:'Final personal report'});await expect(dialog).toBeVisible();
 await expect(dialog.getByText('Mobile Mayor',{exact:true}).first()).toBeVisible();
 await player.getByRole('button',{name:'OK — return to home',exact:true}).click();await expect(dialog).not.toBeVisible();
 await player.reload();await expect(dialog).not.toBeVisible();await expect(player.getByRole('button',{name:'Open final personal report'})).toBeVisible();
 host.once('dialog',d=>d.dismiss());await host.getByRole('button',{name:'Reset game',exact:true}).click();assert.equal((await a.state()).game.phase,'ended');
 host.on('dialog',d=>d.accept(d.type()==='confirm'?'':d.message().includes('password')?a.password:'RESET FINISHED GAME'));
 await host.getByRole('button',{name:'Reset game',exact:true}).click();await expect(host.getByRole('button',{name:'▶ Start the game',exact:true})).toBeVisible();
 await player.reload();await expect(player.getByRole('heading',{name:'Final village report'})).toBeVisible();
 assert.equal((await a.state()).stats.registered,0);assert.deepEqual(errors,[]);
});
