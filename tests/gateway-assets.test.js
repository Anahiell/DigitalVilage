import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway as automatic} from '../deploy/auto-domain/gateway.js';
import {createGateway as manual} from '../deploy/free-domain/public/_worker.js';
import {handlerFixture} from './handler-fixture.mjs';

for(const [name,createGateway] of [['automatic',automatic],['manual',manual]])test(name+' gateway serves the entire browser import graph and exercise page without exposing private files',async t=>{
 const a=await handlerFixture(t),gateway=createGateway(async(url,options)=>{const target=new URL(url),r=await a.handle(target.pathname+target.search,options.method,'',Object.fromEntries(options.headers));return new Response(r.body,{status:r.status,headers:r.headers});});
 const seen=new Set(),queue=['/app.js'];while(queue.length){const path=queue.shift();if(seen.has(path))continue;seen.add(path);const r=await gateway.fetch(new Request('https://digitvillage-play.pages.dev'+path));assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/javascript/);const source=await r.text();for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g)){queue.push(new URL(match[1],'https://digitvillage-play.pages.dev'+path).pathname);}}
 assert.ok(seen.has('/poster-editor.js'));assert.ok(seen.has('/workshop-ui.js'));assert.ok(seen.has('/economy.js'));assert.ok(seen.has('/poster-model.js'));
 for(const path of ['/phishing','/phishing.js'])assert.equal((await gateway.fetch(new Request('https://digitvillage-play.pages.dev'+path))).status,200,path);
 for(const path of ['/.env','/storage/village.db','/server.js','/deploy/auto-domain/controller.mjs'])assert.equal((await gateway.fetch(new Request('https://digitvillage-play.pages.dev'+path))).status,404,path);
});
