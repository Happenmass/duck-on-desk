'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
test('actions wait for sustained standing before and after playback, and time out when not standing',async()=>{
 const {ActionSequence}=await import('../renderer/src/runtime/action-sequence.js');
 const s=new ActionSequence({id:'peck',duration:2.8});
 for(let i=0;i<100;i++)s.advance(.02,false);assert.equal(s.phase,'settling');
 for(let i=0;i<10;i++)s.advance(.02,true);s.advance(.02,false);assert.equal(s.phase,'settling');
 for(let i=0;i<21;i++)s.advance(.02,true);assert.equal(s.phase,'playing');
 for(let i=0;i<140;i++)s.advance(.02,false);assert.equal(s.phase,'returning');
 for(let i=0;i<31;i++)s.advance(.02,true);assert.equal(s.phase,'done');
 const failed=new ActionSequence({duration:8});for(let i=0;i<201;i++)failed.advance(.02,false);assert.equal(failed.phase,'failed');
});
test('random actions require active walking, reset after interruptions and honor disabling',async()=>{
 const {createDuckActions}=await import('../renderer/src/adapters/duck-actions.js');let callback,now=0,plays=[];
 const state={ready:true,busy:false,stilts:0,locomotion:'legs',forward:.6};
 const runtime={snapshot:()=>state,actions:()=>[{id:'peck'},{id:'learned'}],playAction:async id=>plays.push(id)};
 const adapter=createDuckActions({runtime,now:()=>now,random:()=>.75,clock:{setInterval:fn=>{callback=fn;return 1;},clearInterval(){callback=null;}}});
 callback();now=47_600;callback();assert.deepEqual(plays,['learned']);
 state.busy=true;callback();now+=60_000;callback();assert.equal(plays.length,1);
 state.busy=false;callback();now+=20_000;callback();assert.equal(plays.length,1);
 adapter.setEnabled(false);now+=90_000;callback();assert.equal(plays.length,1);
 adapter.setEnabled(true);state.stilts=10;callback();now+=90_000;callback();assert.equal(plays.length,1);
 state.stilts=0;state.forward=0;callback();now+=90_000;callback();assert.equal(plays.length,1);
 adapter.dispose();assert.equal(callback,null);
});
test('random action preference persists through the shared settings schema and rejects strings',()=>{
 const {SCHEMA}=require('../src/shell/prefs');const {updateRegistry}=require('../src/shell/settings-actions');
 assert.equal(SCHEMA.duckRandomActions.default,true);assert.equal(updateRegistry.duckRandomActions(false).status,'ok');assert.equal(updateRegistry.duckRandomActions('false').status,'error');
});
