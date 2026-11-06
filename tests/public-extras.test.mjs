import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
class Element {constructor(id=''){this.id=id;this.textContent='';this.hidden=['phone-block','donor-more','contact-link'].includes(id);this.disabled=false;this.style={};this.children=[];this.handlers={}}append(...x){this.children.push(...x)}addEventListener(k,f){this.handlers[k]=f}}
function makeDocument(){const m=new Map();return {getElementById(id){if(!m.has(id))m.set(id,new Element(id));return m.get(id)},createElement(tag){return new Element(tag)}}}
const wait=()=>new Promise(r=>setTimeout(r,10));

test('public page shows vision, mission, phone and only consented published donors with pagination',async()=>{
  const document=makeDocument();
  const donors=Array.from({length:22},(_,i)=>({id:String(i),display_name:i===0?'<script>not html</script>':'Supporter '+i,amount_cents:1000+i,comment:i===0?'Glad to help':'',created_at:'2026-11-06',published:true,consent_confirmed:true}));
  donors.push({id:'draft',display_name:'PRIVATE DRAFT',amount_cents:100,comment:'',published:false,consent_confirmed:false});
  const client={from(table){let filter={},start=0,end=999;async function response(single=false){
    if(table==='ahf_fundraising_progress')return {data:{cash_cents:125000,pledge_cents:null,inkind_cents:null,note:'',contact:'',updated_at:null},error:null};
    if(table==='ahf_fundraising_site_content')return {data:{vision:'Vision example',mission:'Mission example',phone:'+256 700 000 000'},error:null};
    assert.equal(filter.published,true);assert.equal(filter.consent_confirmed,true);
    return {data:donors.filter(d=>d.published===filter.published && d.consent_confirmed===filter.consent_confirmed).slice(start,end+1),error:null};
  }return {select(){return this},eq(k,v){filter[k]=v;return this},order(){return this},range(a,b){start=a;end=b;return this},maybeSingle(){return response(true)},then(ok,err){return response().then(ok,err)}}}};
  const code=(await readFile(new URL('../public/public.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/,'');
  await runInNewContext(`(async()=>{${code}\n})()`,{document,configured:true,supabase:client});
  const e=id=>document.getElementById(id);
  assert.equal(e('vision-text').textContent,'Vision example');assert.equal(e('mission-text').textContent,'Mission example');
  assert.equal(e('phone-link').href,'tel:+256700000000');assert.equal(e('phone-block').hidden,false);
  assert.equal(e('contact').hidden,true);
  assert.equal(e('donor-list').children.length,20);assert.equal(e('donor-more').hidden,false);
  assert.equal(e('donor-list').children[0].children[0].children[0].textContent,'<script>not html</script>');
  e('donor-more').handlers.click();await wait();
  assert.equal(e('donor-list').children.length,22);assert.equal(e('donor-more').hidden,true);
  assert.equal(JSON.stringify(e('donor-list').children).includes('PRIVATE DRAFT'),false);
  assert.equal(e('remaining').textContent,'$3,750.00');
});
