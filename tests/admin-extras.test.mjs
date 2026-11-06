import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExtras} from '../public/holyghost-extras.js';

class FakeElement {
  constructor(id=''){this.id=id;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';this.children=[];this.handlers={};}
  addEventListener(event,fn){this.handlers[event]=fn}
  setAttribute(){}
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=[...items]}
  scrollIntoView(){}
  reset(){for(const id of ['donor-name','donor-amount','donor-comment']) globalThis.document.getElementById(id).value='';for(const id of ['donor-anonymous','donor-published','donor-consent'])globalThis.document.getElementById(id).checked=false}
}
function makeDocument(){const map=new Map();return {getElementById(id){if(!map.has(id))map.set(id,new FakeElement(id));return map.get(id)},createElement(tag){return new FakeElement(tag)}}}
const wait=()=>new Promise(r=>setTimeout(r,10));
function makeClient(){
  const state={site:{vision:'A brighter future',mission:'Support families',phone:'',revision:0},donors:[],next:1};
  function query(table){let action='select',record,filters={},offset=0,limit=999;
    async function result(single=false){
      if(table==='ahf_fundraising_site_content'){
        if(action==='update'){if(filters.revision!==state.site.revision)return {data:[],error:null};state.site={...state.site,...record,revision:state.site.revision+1};return {data:[{...state.site}],error:null}}
        return {data:single?{...state.site}:[{...state.site}],error:null};
      }
      if(action==='insert'){const row={...record,id:'donor-'+state.next++,revision:0,created_at:'2026-11-06T12:00:00Z'};state.donors.unshift(row);return {data:[{...row}],error:null}}
      if(action==='update' || action==='delete'){
        const row=state.donors.find(x=>x.id===filters.id && x.revision===filters.revision);
        if(!row)return {data:[],error:null};
        if(action==='delete'){state.donors=state.donors.filter(x=>x!==row);return {data:[{id:row.id}],error:null}}
        Object.assign(row,record);row.revision++;return {data:[{...row}],error:null};
      }
      return {data:state.donors.slice(offset,offset+limit).map(x=>({...x})),error:null};
    }
    return {select(){return this},update(r){action='update';record=r;return this},insert(r){action='insert';record=r;return this},delete(){action='delete';return this},eq(k,v){filters[k]=v;return this},order(){return this},range(a,b){offset=a;limit=b-a+1;return this},maybeSingle(){return result(true)},then(ok,err){return result().then(ok,err)}};
  }
  return {state,from:query};
}
const toCents=value=>value===''?null:Math.round(Number(value)*100);

test('admin can manage phone, vision, donor drafts and consented public acknowledgements',async()=>{
  globalThis.document=makeDocument();globalThis.window={confirm:()=>true};
  const client=makeClient();const e=id=>document.getElementById(id);const extras=createExtras(client,toCents);
  extras.open();await wait();
  assert.equal(e('extras-root').hidden,false);assert.equal(e('site-save').disabled,false);
  e('site-vision').value='Our vision';e('site-mission').value='Our mission';e('site-phone').value='+256 700 000 000';
  await e('site-form').handlers.submit({preventDefault(){}});
  assert.equal(client.state.site.phone,'+256 700 000 000');assert.equal(client.state.site.vision,'Our vision');

  e('donor-name').value='Sample supporter';e('donor-amount').value='15';e('donor-comment').value='Draft note';
  await e('donor-form').handlers.submit({preventDefault(){}});
  assert.equal(client.state.donors.length,1);assert.equal(client.state.donors[0].published,false);
  assert.equal(client.state.donors[0].consent_confirmed,false);

  e('donor-name').value='Another';e('donor-amount').value='10';e('donor-published').checked=true;
  await e('donor-form').handlers.submit({preventDefault(){}});
  assert.equal(client.state.donors.length,1);assert.match(e('donor-message').textContent,/Confirm/);

  e('donor-anonymous').checked=true;e('donor-anonymous').handlers.change();e('donor-consent').checked=true;
  await e('donor-form').handlers.submit({preventDefault(){}});
  assert.equal(client.state.donors.length,2);assert.equal(client.state.donors[0].display_name,'Anonymous');
  assert.equal(client.state.donors[0].published,true);assert.equal(client.state.donors[0].consent_confirmed,true);

  const publicItem=e('donor-admin-list').children[0];const actions=publicItem.children.at(-1);
  actions.children[0].handlers.click();
  assert.equal(e('donor-consent').checked,false);
  e('donor-published').checked=false;
  await e('donor-form').handlers.submit({preventDefault(){}});
  assert.equal(client.state.donors[0].published,false);
  assert.equal(client.state.donors[0].revision,1);
  const updatedItem=e('donor-admin-list').children[0];updatedItem.children.at(-1).children[1].handlers.click();
  await wait();assert.equal(client.state.donors.length,1);
  extras.close();assert.equal(e('extras-root').hidden,true);
  delete globalThis.document;delete globalThis.window;
});
