const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('only walking and official roulade are offered as courses',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../renderer/lab.html'),'utf8');
  const select=html.match(/<select id="training-task"[^>]*>(.*?)<\/select>/s)[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(m=>m[1]),['microduck-flat-walk','microduck-roulade']);
});
