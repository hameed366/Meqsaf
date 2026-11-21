'use strict';
(() => {
 const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num = x => Number(x).toLocaleString('ar-KW-u-nu-arab'), money=x=>(Number(x)/1000).toLocaleString('ar-KW-u-nu-arab',{minimumFractionDigits:3,maximumFractionDigits:3})+' د.ك';
 const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuwait',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const grades=['الأول','الثاني','الثالث','الرابع','الخامس','السادس','السابع','الثامن','التاسع','العاشر','الحادي عشر','الثاني عشر'];
 const status = {active:'قيد التجهيز', delivered:'تم التسليم',cancelled:'ملغي'};
 let db, user, profile, menu=[], children=[], orders=[], settings={}, cart={}, view='new', filterDate=today(), filterText='', selectedChild='', selectedPlan='day', selectedStart=today();
 let liveOwner=null, liveTimer=null, liveDebounce=null, liveChannel=null, liveGeneration=0, liveBusy=false, livePending=false;
 const config=window.MAQSAF_CONFIG||{};
 function fail(e){console.error(e); $('#error').textContent='تعذّر إكمال العملية: '+(e?.message||'تحقق من الاتصال والإعدادات وحاول مجددًا.');$('#error').hidden=false;}
 function clearError(){$('#error').hidden=true} function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;setTimeout(()=>t.hidden=true,3500)}
 function check(r){if(r.error)throw r.error;return r.data}
 function appError(e){fail(e);}
 function show(id){['setup','auth','app'].forEach(x=>$('#'+x).hidden=x!==id);$('#logout').hidden=id!=='app'}
 async function load(){
  clearError();
  const pr=check(await db.from('profiles').select('id,role,balance').eq('id',user.id).maybeSingle());
  if(!pr)throw Error('تعذر العثور على ملف الحساب. تأكد من تشغيل ملف قاعدة البيانات قبل إنشاء الحساب.');profile=pr;
  const qs=[db.from('menu').select('*').order('created_at'), db.from('settings').select('*').eq('id',1).single()];
  if(profile.role==='parent')qs.push(db.from('children').select('*').order('created_at'),db.from('orders').select('*').order('day',{ascending:false}).limit(500));
  else qs.push(db.from('orders').select('*').order('day',{ascending:false}).limit(1000));
  const results=await Promise.all(qs);menu=check(results[0]);settings=check(results[1]);
  if(profile.role==='parent'){children=check(results[2]);orders=check(results[3]);}else orders=check(results[2]);
  $('#school').textContent=settings.school||'اطلب من البيت واستلم بسهولة';$('#who').textContent=user.email+' · '+({parent:'ولي أمر',canteen:'المقصف',admin:'الإدارة'}[profile.role]||'');show('app');render();
  if(profile.role==='admin'||profile.role==='canteen')startStaffUpdates();else stopStaffUpdates();
 }
 function stopStaffUpdates(){
  liveGeneration++;liveOwner=null;liveBusy=false;livePending=false;
  if(liveTimer!==null)clearInterval(liveTimer);liveTimer=null;
  if(liveDebounce!==null)clearTimeout(liveDebounce);liveDebounce=null;
  if(liveChannel){try{db.removeChannel(liveChannel)}catch(e){console.warn('تعذر إغلاق تحديث الطلبات',e)}liveChannel=null;}
 }
 function queueStaffUpdate(){
  if(liveDebounce!==null)clearTimeout(liveDebounce);
  liveDebounce=setTimeout(()=>{liveDebounce=null;refreshStaffOrders()},250);
 }
 async function refreshStaffOrders(){
  if(!liveOwner||!user||user.id!==liveOwner||document.hidden)return;
  if(liveBusy){livePending=true;return}
  const generation=liveGeneration,owner=liveOwner;liveBusy=true;
  try{
   const fresh=check(await db.from('orders').select('*').order('day',{ascending:false}).limit(1000));
   if(generation!==liveGeneration||!user||user.id!==owner)return;
   orders=fresh;
   if(view==='work')renderStaffList();
   const status=$('#liveStatus');if(status)status.textContent='تحديث الطلبات تلقائيًا';
  }catch(e){
   if(generation===liveGeneration){const status=$('#liveStatus');if(status)status.textContent='تعذر التحديث التلقائي؛ تحقق من الاتصال.';console.warn('تعذر تحديث الطلبات',e)}
  }finally{
   if(generation===liveGeneration){liveBusy=false;if(livePending){livePending=false;queueStaffUpdate()}}
  }
 }
 function startStaffUpdates(){
  if(!user||liveOwner===user.id)return;
  stopStaffUpdates();liveOwner=user.id;
  liveTimer=setInterval(refreshStaffOrders,10000);
  try{
   liveChannel=db.channel('canteen-orders-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},queueStaffUpdate)
    .subscribe(status=>{if(status==='SUBSCRIBED')queueStaffUpdate()});
  }catch(e){console.warn('التحديث المباشر غير متاح؛ سيستمر التحديث الدوري.',e)}
 }
 function render(){
  let tabs=profile.role==='parent'?[['new','طلب جديد'],['orders','تذاكري']]:profile.role==='canteen'?[['work','طلبات المقصف']]:[['work','الطلبات'],['manage','الأصناف'],['settings','الإعدادات']];
  if(!tabs.some(t=>t[0]===view)&&!(profile.role==='parent'&&view==='children'))view=tabs[0][0];
  $('#wallet').innerHTML=profile.role==='parent'?`<div class="wallet"><div><span class="wallet-label">الرصيد التجريبي</span><span class="wallet-balance">${money(profile.balance)}</span></div><button type="button" data-act="topup">شحن تجريبي</button></div>`:'';
  $('#nav').innerHTML=tabs.map(([id,title])=>`<button type="button" data-tab="${id}" class="${view===id?'active':''}">${title}</button>`).join('');
  if(view==='new')renderNew();if(view==='orders')renderOrders(false);if(view==='children')renderChildren();if(view==='work')renderOrders(true);if(view==='manage')renderManage();if(view==='settings')renderSettings();
 }
 function renderNew(){
  const active=menu.filter(m=>m.available);
  if(!children.some(c=>c.id===selectedChild))selectedChild=children[0]?.id||'';
  const selected=Object.entries(cart).filter(([,q])=>q>0).length;
  const categories=[...new Set(active.map(m=>m.category||'أصناف أخرى'))];
  const plans=[['day','يوم واحد','طلب يومي'],['week','أسبوع',`٥ أيام دراسية · خصم ${num(settings.week_discount)}٪`],['month','شهر',`٢٠ يومًا دراسيًا · خصم ${num(settings.month_discount)}٪`]];
  $('#content').innerHTML=`<div class="parent-flow">
  <div class="section-head"><h2>لمن الطلب؟</h2>${children.length?'<button class="link-button" type="button" data-tab="children">إدارة الأبناء</button>':''}</div>
  <div class="chips">${children.map(c=>`<button type="button" class="chip" data-act="select-child" data-id="${esc(c.id)}" aria-pressed="${selectedChild===c.id}">${esc(c.name)}<small>الصف ${grades[c.grade-1]} · شعبة ${num(c.section)}</small></button>`).join('')}<button type="button" class="chip add" data-act="child">+ إضافة ابن أو ابنة</button></div>
  ${children.length?'':'<p class="small">أضف اسم الطالب وصفّه أولًا، ليعرف المقصف لمن يسلّم الوجبة.</p>'}
  <h2>مدة الطلب</h2><div class="plan-seg">${plans.map(([id,title,description])=>`<button type="button" data-act="select-plan" data-value="${id}" aria-pressed="${selectedPlan===id}">${title}<small>${description}</small></button>`).join('')}</div>
  <label class="start-row"><span>يبدأ من</span><input id="start" type="date" min="${today()}" value="${esc(selectedStart)}"></label><p class="small">أيام الدراسة من الأحد إلى الخميس. لا تُستبعد العطلات الرسمية تلقائيًا.</p>
  <h2>قائمة المقصف</h2>${active.length?categories.map(category=>`<section><div class="category">${esc(category)}</div><div class="menu-list">${active.filter(m=>(m.category||'أصناف أخرى')===category).map(m=>`<div class="item"><div class="menu-name"><strong>${esc(m.name)}</strong><small>${money(m.price)}</small></div><div class="controls">${cart[m.id]?`<button type="button" data-act="dec" data-id="${esc(m.id)}" class="outline" aria-label="إنقاص ${esc(m.name)}">−</button><b>${num(cart[m.id])}</b>`:''}<button type="button" data-act="inc" data-id="${esc(m.id)}" aria-label="إضافة ${esc(m.name)}">+</button></div></div>`).join('')}</div></section>`).join(''):'<div class="empty">لا توجد أصناف متاحة.</div>'}
  ${selected?`<div class="checkout-bar"><div class="checkout-inner"><span>الأصناف المختارة: ${num(selected)}</span><button type="button" data-act="checkout" ${!children.length?'disabled':''}>مراجعة الطلب</button></div></div>`:''}</div>`;
 }
 function orderCard(o,staff){let items=(o.items||[]).map(i=>`${num(i.qty)} × ${esc(i.name)}`).join('، ');return `<div class="card ticket"><div class="between"><strong>${esc(o.child_name)}</strong><span class="badge ${o.status==='cancelled'?'warn':''}">${status[o.status]||''}</span></div><p>الصف ${grades[o.grade-1]} · الشعبة ${num(o.section)} · ${esc(o.day)}</p><p>${items}</p><div class="between"><b class="ticket-code">رمز الاستلام: ${esc(o.code)}</b><span class="money">${money(o.amount)}</span></div>${staff&&o.status!=='cancelled'?`<div class="actions"><button data-act="delivery" data-id="${o.id}" data-value="${o.status==='delivered'?'false':'true'}" class="${o.status==='delivered'?'outline':''}">${o.status==='delivered'?'إلغاء التسليم':'تم التسليم'}</button></div>`:!staff&&o.status==='active'&&o.day>today()?`<div class="actions"><button class="danger" data-act="cancel" data-id="${o.id}">إلغاء هذا اليوم واسترداد رصيده</button></div>`:''}</div>`}
 function renderStaffList(){
  const target=$('#staffOrders'),count=$('#staffCount');if(!target||!count)return;
  const list=orders.filter(o=>o.day===filterDate&&(o.child_name.includes(filterText)||o.code.includes(filterText)));
  count.textContent=num(list.length);
  target.innerHTML=list.length?list.map(o=>orderCard(o,true)).join(''):'<div class="card empty">لا توجد طلبات للعرض.</div>';
 }
 function renderOrders(staff){
  if(staff){$('#content').innerHTML=`<div class="card"><div class="grid"><label>تاريخ الطلبات<input type="date" id="filterDate" value="${filterDate}"></label><label>البحث بالاسم أو الرمز<input type="search" id="filterText" value="${esc(filterText)}"></label></div><p>عدد الطلبات المعروضة: <span id="staffCount"></span></p><p class="small" id="liveStatus" role="status">تحديث الطلبات تلقائيًا</p></div><div id="staffOrders"></div>`;renderStaffList();}
  else $('#content').innerHTML=orders.length?orders.map(o=>orderCard(o,false)).join(''):'<div class="card empty">لا توجد طلبات للعرض.</div>';
 }
 function renderChildren(){$('#content').innerHTML=`<div class="card"><div class="between"><h2>أبنائي</h2><button data-act="child">إضافة طالب</button></div>${children.length?children.map(c=>`<div class="item"><div><b>${esc(c.name)}</b><div class="muted">الصف ${grades[c.grade-1]} · شعبة ${num(c.section)}</div></div><div class="actions"><button class="outline smallbtn" data-act="edit-child" data-id="${c.id}">تعديل</button><button class="danger smallbtn" data-act="delete-child" data-id="${c.id}">حذف</button></div></div>`).join(''):'<div class="empty">لم تضف طلابًا بعد.</div>'}</div>`;}
 function renderManage(){$('#content').innerHTML=`<div class="card"><div class="between"><h2>إدارة الأصناف</h2><button data-act="item">إضافة صنف</button></div>${menu.map(m=>`<div class="item"><div><b>${esc(m.name)}</b><div class="muted">${esc(m.category)} · ${money(m.price)} · ${m.available?'متاح':'غير متاح'}</div></div><div class="actions"><button class="outline smallbtn" data-act="edit-item" data-id="${m.id}">تعديل</button><button class="outline smallbtn" data-act="toggle-item" data-id="${m.id}">${m.available?'إيقاف':'إتاحة'}</button></div></div>`).join('')}</div>`;}
 function renderSettings(){$('#content').innerHTML=`<div class="card"><h2>إعدادات المدرسة والاشتراكات</h2><form id="settingsForm"><label>اسم المدرسة<input name="school" maxlength="60" value="${esc(settings.school)}"></label><label>خصم الأسبوع ٪<input name="week" type="number" min="0" max="50" required value="${settings.week_discount}"></label><label>خصم ٢٠ يومًا ٪<input name="month" type="number" min="0" max="50" required value="${settings.month_discount}"></label><button>حفظ الإعدادات</button></form><p class="small">إدارة الحسابات ومنح الأدوار تتم حاليًا من لوحة قاعدة البيانات بحسب دليل التشغيل.</p></div>`;}
 function modal(html){$('#dialogBody').innerHTML=html;$('#dialog').showModal()}function close(){$('#dialog').close()}
 function childForm(c={}){modal(`<h2>${c.id?'تعديل':'إضافة'} طالب</h2><form id="childForm" data-id="${c.id||''}"><label>اسم الطالب<input name="name" required maxlength="40" value="${esc(c.name||'')}"></label><div class="grid"><label>الصف<select name="grade">${grades.map((g,i)=>`<option value="${i+1}" ${Number(c.grade||6)===i+1?'selected':''}>${g}</option>`).join('')}</select></label><label>الشعبة<select name="section">${grades.map((_,i)=>`<option value="${i+1}" ${Number(c.section||1)===i+1?'selected':''}>${num(i+1)}</option>`).join('')}</select></label></div><div class="actions"><button>حفظ</button><button type="button" data-act="close" class="outline">إلغاء</button></div></form>`)}
 function itemForm(m={}){modal(`<h2>${m.id?'تعديل':'إضافة'} صنف</h2><form id="itemForm" data-id="${m.id||''}"><label>اسم الصنف<input name="name" required maxlength="40" value="${esc(m.name||'')}"></label><label>التصنيف<input name="category" required maxlength="30" value="${esc(m.category||'')}"></label><label>السعر بالفلس<input name="price" type="number" min="5" max="20000" required value="${m.price||250}"></label><div class="actions"><button>حفظ</button><button type="button" class="outline" data-act="close">إلغاء</button></div></form>`)}
 function checkout(){const child=selectedChild,plan=selectedPlan,start=$('#start')?.value||selectedStart;const list=menu.filter(m=>m.available&&cart[m.id]);if(!child||!list.length)return;const discount=plan==='week'?settings.week_discount:plan==='month'?settings.month_discount:0,n=plan==='week'?5:plan==='month'?20:1;const perday=Math.round(list.reduce((s,m)=>s+m.price*cart[m.id],0)*(100-discount)/100);modal(`<h2>مراجعة الطلب</h2><p>${list.map(m=>`${num(cart[m.id])} × ${esc(m.name)}`).join('، ')}</p><p>البداية: ${esc(start)} · عدد الأيام: ${num(n)}</p><p>المجموع التجريبي: <b>${money(perday*n)}</b></p><p class="small">تُراجع الأسعار والرصيد في قاعدة البيانات عند التأكيد. شحن الرصيد والدفع للتجربة فقط.</p><div class="actions"><button data-act="confirm-order" data-child="${esc(child)}" data-plan="${esc(plan)}" data-start="${esc(start)}">تأكيد الطلب التجريبي</button><button class="outline" data-act="close">رجوع</button></div>`)}
 async function action(b){let id=b.dataset.id;switch(b.dataset.act){
 case 'close':close();break;case 'inc':cart[id]=Math.min(9,(cart[id]||0)+1);renderNew();break;case 'dec':cart[id]=Math.max(0,(cart[id]||0)-1);renderNew();break;
 case 'select-child':if(children.some(c=>c.id===id)){selectedChild=id;renderNew();}break;
 case 'select-plan':if(['day','week','month'].includes(b.dataset.value)){selectedPlan=b.dataset.value;renderNew();}break;
 case 'child':childForm();break;case 'edit-child':childForm(children.find(c=>c.id===id));break;
 case 'delete-child':if(confirm('هل تريد حذف الطالب؟ ستبقى الطلبات السابقة محفوظة.')){check(await db.from('children').delete().eq('id',id));await load();toast('حُذف الطالب');}break;
 case 'item':itemForm();break;case 'edit-item':itemForm(menu.find(m=>m.id===id));break;
 case 'toggle-item':{let m=menu.find(x=>x.id===id);check(await db.from('menu').update({available:!m.available}).eq('id',id));await load();toast('تم التحديث');break;}
 case 'topup':modal('<h2>شحن رصيد تجريبي</h2><p>هذا رصيد افتراضي للتجربة فقط ولا يمثل أي مبلغ مالي.</p><div class="actions">'+[1000,3000,5000,10000].map(n=>`<button data-act="add-credit" data-amount="${n}">${money(n)}</button>`).join('')+'</div><div class="actions"><button class="outline" data-act="close">إغلاق</button></div>');break;
 case 'add-credit':check(await db.rpc('demo_topup',{p_amount:Number(b.dataset.amount)}));close();await load();toast('أضيف الرصيد التجريبي');break;
 case 'checkout':checkout();break;
 case 'confirm-order':{let p_cart=Object.entries(cart).filter(([id,q])=>q>0&&menu.some(m=>m.id===id&&m.available)).map(([id,qty])=>({id,qty}));check(await db.rpc('place_order',{p_child:b.dataset.child,p_cart,p_plan:b.dataset.plan,p_start:b.dataset.start}));cart={};close();view='orders';await load();toast('تم إنشاء الطلب التجريبي');break;}
 case 'cancel':if(confirm('إلغاء هذا اليوم وإعادة قيمته التجريبية؟')){check(await db.rpc('cancel_order',{p_id:id}));await load();toast('أُلغي اليوم وأعيد الرصيد التجريبي');}break;
 case 'delivery':check(await db.rpc('set_delivery',{p_id:id,p_delivered:b.dataset.value==='true'}));await load();toast('تم تحديث حالة التسليم');break;
 }}
 async function submit(f){const x=new FormData(f);switch(f.id){case 'loginForm':check(await db.auth.signInWithPassword({email:String(x.get('email')).trim(),password:x.get('password')}));break;
 case 'childForm':{let data={name:String(x.get('name')).trim(),grade:Number(x.get('grade')),section:Number(x.get('section'))};if(!data.name)throw Error('أدخل اسم الطالب');if(f.dataset.id)check(await db.from('children').update(data).eq('id',f.dataset.id));else check(await db.from('children').insert({...data,parent_id:user.id}));close();await load();toast('حُفظ الطالب');break;}
 case 'itemForm':{let data={name:String(x.get('name')).trim(),category:String(x.get('category')).trim(),price:Number(x.get('price'))};if(!data.name||!data.category)throw Error('أكمل بيانات الصنف');if(f.dataset.id)check(await db.from('menu').update(data).eq('id',f.dataset.id));else check(await db.from('menu').insert(data));close();await load();toast('حُفظ الصنف');break;}
 case 'settingsForm':check(await db.from('settings').update({school:String(x.get('school')).trim(),week_discount:Number(x.get('week')),month_discount:Number(x.get('month'))}).eq('id',1));await load();toast('حُفظت الإعدادات');break;}}
 document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{clearError();if(b.dataset.tab){view=b.dataset.tab;render();return}if(b.dataset.act){b.disabled=true;try{await action(b)}finally{b.disabled=false}}}catch(err){appError(err)}});
 document.addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button[type=submit],button:not([type])');try{clearError();if(b)b.disabled=true;await submit(e.target)}catch(err){appError(err)}finally{if(b)b.disabled=false}});
 document.addEventListener('change',e=>{if(e.target.id==='child')selectedChild=e.target.value;if(e.target.id==='plan')selectedPlan=e.target.value;if(e.target.id==='start')selectedStart=e.target.value;if(e.target.id==='filterDate'){filterDate=e.target.value;renderStaffList()}});
 document.addEventListener('input',e=>{if(e.target.id==='filterText'){filterText=e.target.value;renderStaffList()}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshStaffOrders()});
 $('#signup').addEventListener('click',async()=>{try{clearError();const form=$('#loginForm');if(!form.reportValidity())return;const data=new FormData(form);const result=check(await db.auth.signUp({email:String(data.get('email')).trim(),password:data.get('password'),options:{emailRedirectTo:location.origin+location.pathname}}));toast(result.session?'تم إنشاء الحساب':'تحقق من بريدك لتأكيد الحساب، ثم سجّل الدخول.')}catch(e){appError(e)}});
 $('#logout').addEventListener('click',async()=>{try{check(await db.auth.signOut());user=null;cart={};show('auth')}catch(e){appError(e)}});
 $('#refresh').addEventListener('click',()=>load().then(()=>toast('تم التحديث')).catch(appError));
 if(!config.SUPABASE_URL||!config.SUPABASE_ANON_KEY){show('setup');return}if(!window.supabase){fail(Error('تعذر تحميل مكتبة الاتصال. تحقق من الإنترنت وأعد فتح الصفحة.'));show('setup');return}
 try{db=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY);db.auth.onAuthStateChange((_event,session)=>{const next=session?.user||null;if(liveOwner&&(!next||next.id!==liveOwner))stopStaffUpdates();user=next;if(user)setTimeout(()=>load().catch(appError),0);else{profile=null;orders=[];show('auth')}})}catch(e){fail(e);show('setup')}
})();


