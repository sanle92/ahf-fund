// The public progress total is intentionally separate from acknowledgements.
export function createExtras(client, toCents) {
  const e = id => document.getElementById(id);
  const siteColumns = 'vision,mission,phone,revision,updated_at';
  const donorColumns = 'id,display_name,amount_cents,comment,published,consent_confirmed,created_at,revision,updated_at';
  const pageSize = 10;
  let active=false, generation=0, listGeneration=0, siteRevision=null;
  let donorOffset=0, editing=null, donorsReady=false, donorBusy=false, siteBusy=false, donorLocked=false;
  const valid = ticket => active && ticket === generation;
  const status = (id,text) => { e(id).textContent=text; };
  const format = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

  function resetDonorForm() {
    editing=null; donorLocked=false;
    e('donor-form').reset();
    e('donor-name').disabled=false;
    e('donor-form-title').textContent='Add a supporter';
    e('donor-save').textContent='Save supporter';
    e('donor-cancel').textContent='Cancel editing';
    e('donor-cancel').hidden=true;
    e('donor-save').disabled=!donorsReady || donorBusy;
  }

  async function loadSite(ticket) {
    e('site-save').disabled=true;
    status('site-message','Loading foundation details…');
    try {
      const {data,error}=await client.from('ahf_fundraising_site_content').select(siteColumns).eq('id',1).maybeSingle();
      if (!valid(ticket)) return;
      if (error || !data) throw error || new Error('Missing content');
      siteRevision=data.revision;
      e('site-vision').value=data.vision || '';
      e('site-mission').value=data.mission || '';
      e('site-phone').value=data.phone || '';
      e('site-reload').hidden=true;
      e('site-save').disabled=false;
      status('site-message','Ready to update.');
    } catch {
      if (!valid(ticket)) return;
      siteRevision=null;
      status('site-message','Foundation details are unavailable. Run the donor and contact upgrade SQL in the same Supabase project, then reload.');
    }
  }

  function startEdit(row) {
    if (!active || donorBusy) return;
    editing={id:row.id,revision:row.revision};
    donorLocked=false;
    const anonymous=row.display_name === 'Anonymous';
    e('donor-anonymous').checked=anonymous;
    e('donor-name').value=anonymous ? '' : row.display_name;
    e('donor-name').disabled=anonymous;
    e('donor-amount').value=(row.amount_cents/100).toFixed(2);
    e('donor-comment').value=row.comment || '';
    e('donor-published').checked=row.published;
    // Confirm again when changing a public acknowledgement.
    e('donor-consent').checked=false;
    e('donor-form-title').textContent='Edit supporter';
    e('donor-save').textContent='Save changes';
    e('donor-save').disabled=!donorsReady;
    e('donor-cancel').hidden=false;
    status('donor-message',row.published ? 'Confirm permission again before saving a published acknowledgement.' : 'Editing a draft.');
    e('donor-form').scrollIntoView?.({behavior:'smooth',block:'start'});
  }

  async function deleteDonor(row) {
    if (!active || donorBusy || !window.confirm('Delete this supporter acknowledgement?')) return;
    const ticket=generation;
    donorBusy=true;e('donor-save').disabled=true;
    status('donor-list-message','Deleting…');
    try {
      const {data,error}=await client.from('ahf_fundraising_donors').delete()
        .eq('id',row.id).eq('revision',row.revision).select('id');
      if (!valid(ticket)) return;
      if (error || !Array.isArray(data)) throw error || new Error('Unexpected response');
      if (data.length !== 1) {
        status('donor-list-message','Not deleted: this acknowledgement may have changed. Refresh the list and try again.');
        return;
      }
      if (editing?.id === row.id) resetDonorForm();
      status('donor-message','Acknowledgement deleted.');
      await loadDonors(ticket,donorOffset);
    } catch {
      if (valid(ticket)) status('donor-list-message','Deletion could not be confirmed. Refresh the list and check before trying again.');
    } finally {
      if (valid(ticket)) {donorBusy=false;e('donor-save').disabled=!donorsReady || donorLocked;}
    }
  }

  function renderDonor(row) {
    const item=document.createElement('li');item.className='donor-admin-item';
    const title=document.createElement('strong');title.textContent=row.display_name + ' · ' + format(row.amount_cents);
    const visibility=document.createElement('div');visibility.className='subtext';visibility.textContent=row.published ? 'Published' : 'Draft — not public';
    item.append(title,visibility);
    if(row.comment){const comment=document.createElement('p');comment.className='subtext donor-comment';comment.textContent=row.comment;item.append(comment)}
    const actions=document.createElement('div');actions.className='donor-admin-actions';
    const edit=document.createElement('button');edit.type='button';edit.className='button secondary';edit.textContent='Edit';
    edit.setAttribute('aria-label','Edit acknowledgement for '+row.display_name);edit.addEventListener('click',()=>startEdit(row));
    const remove=document.createElement('button');remove.type='button';remove.className='button secondary';remove.textContent='Delete';
    remove.setAttribute('aria-label','Delete acknowledgement for '+row.display_name);remove.addEventListener('click',()=>{void deleteDonor(row)});
    actions.append(edit,remove);item.append(actions);
    return item;
  }

  async function loadDonors(ticket,offset) {
    const request=++listGeneration;
    e('donor-prev').disabled=true;e('donor-next').disabled=true;
    status('donor-list-message','Loading acknowledgements…');
    try {
      const {data,error}=await client.from('ahf_fundraising_donors').select(donorColumns)
        .order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+pageSize);
      if (!valid(ticket) || request!==listGeneration) return;
      if (error || !Array.isArray(data)) throw error || new Error('Unexpected response');
      if (!data.length && offset>0) { await loadDonors(ticket,Math.max(0,offset-pageSize));return; }
      donorOffset=offset;
      e('donor-admin-list').replaceChildren(...data.slice(0,pageSize).map(renderDonor));
      donorsReady=true;
      e('donor-save').disabled=donorBusy || donorLocked;
      e('donor-prev').disabled=offset===0;
      e('donor-next').disabled=data.length<=pageSize;
      e('donor-page').textContent=data.length ? 'Page '+(Math.floor(offset/pageSize)+1) : '';
      status('donor-list-message',data.length ? '' : 'No acknowledgements yet.');
    } catch {
      if (!valid(ticket) || request!==listGeneration) return;
      donorsReady=false;e('donor-save').disabled=true;
      status('donor-list-message','Acknowledgements are unavailable. Run the donor and contact upgrade SQL in the same Supabase project, then refresh.');
    }
  }

  e('site-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!active || siteRevision===null || siteBusy)return;
    const ticket=generation;siteBusy=true;e('site-save').disabled=true;
    try {
      const vision=e('site-vision').value.trim(),mission=e('site-mission').value.trim(),phone=e('site-phone').value.trim();
      if(!vision || !mission) throw new Error('Please enter both the vision and the mission.');
      const digits=phone.replace(/\D/g,'');
      if(phone && (!/^\+?[0-9().\s-]+$/.test(phone) || digits.length<7 || digits.length>15)) throw new Error('Enter a valid phone number with 7 to 15 digits, or leave it blank.');
      const {data,error}=await client.from('ahf_fundraising_site_content').update({vision,mission,phone})
        .eq('id',1).eq('revision',siteRevision).select(siteColumns);
      if(!valid(ticket))return;
      if(error || !Array.isArray(data))throw error || new Error('Unexpected response');
      if(data.length!==1){siteRevision=null;e('site-reload').hidden=false;status('site-message','Not saved: details may have changed elsewhere. Reload before trying again.');return}
      siteRevision=data[0].revision;e('site-reload').hidden=true;status('site-message','Saved. The public page has been updated.');
    } catch(error) {
      if(!valid(ticket))return;
      if(error?.message?.startsWith('Please enter') || error?.message?.startsWith('Enter a valid phone')) status('site-message',error.message);
      else {siteRevision=null;e('site-reload').hidden=false;status('site-message','Save could not be confirmed. Reload and check the latest details.');}
    } finally {if(valid(ticket)){siteBusy=false;e('site-save').disabled=siteRevision===null;}}
  });
  e('site-reload').addEventListener('click',()=>{if(active)void loadSite(generation)});
  e('donor-anonymous').addEventListener('change',()=>{
    e('donor-name').disabled=e('donor-anonymous').checked;
    if(e('donor-anonymous').checked)e('donor-name').value='';
  });
  e('donor-cancel').addEventListener('click',()=>{resetDonorForm();status('donor-message','Editing cancelled.');});
  e('donor-prev').addEventListener('click',()=>{if(active)void loadDonors(generation,Math.max(0,donorOffset-pageSize))});
  e('donor-next').addEventListener('click',()=>{if(active)void loadDonors(generation,donorOffset+pageSize)});
  e('donor-refresh').addEventListener('click',()=>{if(active)void loadDonors(generation,donorOffset)});
  e('donor-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!active || !donorsReady || donorBusy || donorLocked)return;
    const ticket=generation;donorBusy=true;e('donor-save').disabled=true;
    try {
      const name=e('donor-anonymous').checked ? 'Anonymous' : e('donor-name').value.trim();
      const cents=toCents(e('donor-amount').value);
      const published=e('donor-published').checked,consent=e('donor-consent').checked;
      if(!name)throw new Error('Enter the donor name or choose Anonymous.');
      if(cents===null || cents<1)throw new Error('Enter an amount greater than zero.');
      if(published && !consent)throw new Error('Confirm the donor agreed to publish these details.');
      const record={display_name:name,amount_cents:cents,comment:e('donor-comment').value.trim(),published,consent_confirmed:consent};
      let result;
      if(editing) result=await client.from('ahf_fundraising_donors').update(record)
        .eq('id',editing.id).eq('revision',editing.revision).select(donorColumns);
      else result=await client.from('ahf_fundraising_donors').insert(record).select(donorColumns);
      if(!valid(ticket))return;
      if(result.error || !Array.isArray(result.data))throw result.error || new Error('Unexpected response');
      if(result.data.length!==1){donorLocked=true;status('donor-message','Not saved: this acknowledgement or your access may have changed. Refresh the list, cancel editing, and try again.');return}
      resetDonorForm();status('donor-message',published ? 'Saved and published.' : 'Saved as a private draft.');
      await loadDonors(ticket,0);
    } catch(error) {
      if(!valid(ticket))return;
      if(/^(Enter |Confirm |Amount is too large\.)/.test(error?.message || '')) status('donor-message',error.message);
      else {donorLocked=true;e('donor-cancel').hidden=false;e('donor-cancel').textContent='Clear form';status('donor-message','Save could not be confirmed. Refresh the list and check before trying again, then clear the form.');}
    } finally {if(valid(ticket)){donorBusy=false;e('donor-save').disabled=!donorsReady || donorLocked;}}
  });

  return {
    open(){active=true;const ticket=++generation;siteRevision=null;donorsReady=false;donorOffset=0;donorBusy=false;siteBusy=false;resetDonorForm();e('extras-root').hidden=false;void loadSite(ticket);void loadDonors(ticket,0)},
    close(){active=false;generation++;listGeneration++;e('extras-root').hidden=true;siteRevision=null;donorsReady=false;donorBusy=false;siteBusy=false;resetDonorForm();e('donor-admin-list').replaceChildren();status('donor-message','')}
  };
}
