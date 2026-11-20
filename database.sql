-- مقصف بلا طابور — قاعدة تجريبية جديدة على Supabase. شغّلها مرة واحدة في مشروع جديد.
begin;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role text not null default 'parent' check(role in ('parent','canteen','admin')), balance integer not null default 0 check(balance>=0), created_at timestamptz not null default now());
create table public.children (id uuid primary key default gen_random_uuid(), parent_id uuid not null default auth.uid() references public.profiles(id), name text not null check(char_length(trim(name)) between 1 and 40), grade smallint not null check(grade between 1 and 12), section smallint not null check(section between 1 and 12), created_at timestamptz not null default now());
create table public.menu (id uuid primary key default gen_random_uuid(), name text not null check(char_length(trim(name)) between 1 and 40), category text not null check(char_length(trim(category)) between 1 and 30), price integer not null check(price between 5 and 20000), available boolean not null default true, created_at timestamptz not null default now());
create table public.settings (id integer primary key default 1 check(id=1), school text not null default '', week_discount integer not null default 5 check(week_discount between 0 and 50), month_discount integer not null default 10 check(month_discount between 0 and 50));
create table public.orders (id uuid primary key default gen_random_uuid(), parent_id uuid not null references public.profiles(id), child_name text not null, grade smallint not null, section smallint not null, items jsonb not null, day date not null, amount integer not null check(amount>=0), code text not null, status text not null default 'active' check(status in ('active','delivered','cancelled')), created_at timestamptz not null default now());
create table public.transactions (id uuid primary key default gen_random_uuid(), parent_id uuid not null references public.profiles(id), amount integer not null, kind text not null check(kind in ('demo_topup','order','refund')), order_id uuid, created_at timestamptz not null default now());
insert into public.settings(id) values (1);
insert into public.menu(name,category,price) values ('فطيرة جبن','فطائر وساندويتشات',250),('فطيرة زعتر','فطائر وساندويتشات',200),('ساندويتش فلافل','فطائر وساندويتشات',250),('ساندويتش لبنة وخيار','فطائر وساندويتشات',250),('ماء','مشروبات',100),('عصير برتقال طبيعي','مشروبات',250),('حليب','مشروبات',150),('لبن','مشروبات',150),('تفاح','فواكه',150),('موز','فواكه',100),('سلطة فواكه','فواكه',350),('تمر','وجبات خفيفة',150);
create function public.new_profile() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id) values(new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_profile();
-- Security-definer helper reads the authoritative role, never user metadata.
create function public.my_role() returns text language sql stable security definer set search_path='' as $$ select role from public.profiles where id=auth.uid() $$;
revoke all on function public.new_profile() from public, anon, authenticated;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;
alter table public.profiles enable row level security;
alter table public.children enable row level security;
alter table public.menu enable row level security;
alter table public.settings enable row level security;
alter table public.orders enable row level security;
alter table public.transactions enable row level security;
revoke all on public.profiles,public.children,public.menu,public.settings,public.orders,public.transactions from anon,authenticated;
grant select on public.profiles,public.children,public.menu,public.settings,public.orders,public.transactions to authenticated;
grant insert,update,delete on public.children,public.menu to authenticated;
grant update on public.settings to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() or public.my_role()='admin');
create policy children_read on public.children for select to authenticated using (parent_id=auth.uid() or public.my_role()='admin');
create policy children_insert on public.children for insert to authenticated with check (parent_id=auth.uid() and public.my_role()='parent');
create policy children_update on public.children for update to authenticated using (parent_id=auth.uid() and public.my_role()='parent') with check (parent_id=auth.uid());
create policy children_delete on public.children for delete to authenticated using (parent_id=auth.uid() and public.my_role()='parent');
create policy menu_read on public.menu for select to authenticated using (true);
create policy menu_insert on public.menu for insert to authenticated with check (public.my_role()='admin');
create policy menu_update on public.menu for update to authenticated using (public.my_role()='admin') with check (public.my_role()='admin');
create policy menu_delete on public.menu for delete to authenticated using (public.my_role()='admin');
create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated using (public.my_role()='admin') with check (public.my_role()='admin');
create policy orders_read on public.orders for select to authenticated using (parent_id=auth.uid() or public.my_role() in ('admin','canteen'));
create policy transactions_read on public.transactions for select to authenticated using (parent_id=auth.uid() or public.my_role()='admin');
-- The entire wallet is simulated. Never use for real money.
create function public.demo_topup(p_amount integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.my_role() is distinct from 'parent' then raise exception 'غير مصرح'; end if;
 if p_amount not in (1000,3000,5000,10000) then raise exception 'المبلغ غير صالح'; end if;
 update public.profiles set balance=balance+p_amount where id=auth.uid();
 insert into public.transactions(parent_id,amount,kind) values(auth.uid(),p_amount,'demo_topup');
end $$;
create function public.place_order(p_child uuid,p_cart jsonb,p_plan text,p_start date) returns integer language plpgsql security definer set search_path='' as $$
declare childrow public.children%rowtype; config public.settings%rowtype; item record; x jsonb; items jsonb='[]'::jsonb; perday integer=0; discount integer=0; n integer; amount integer; bal integer; d date; i integer=0; receipt uuid; todaykw date=(now() at time zone 'Asia/Kuwait')::date;
begin
 if auth.uid() is null or public.my_role() is distinct from 'parent' then raise exception 'غير مصرح'; end if;
 select * into childrow from public.children where id=p_child and parent_id=auth.uid();
 if not found then raise exception 'الطالب غير موجود'; end if;
 if p_plan is null or p_plan not in ('day','week','month') or p_start is null or p_start<todaykw or p_start>todaykw+60 or extract(dow from p_start) in (5,6) then raise exception 'المدة أو تاريخ البداية غير صالح'; end if;
 if p_cart is null or jsonb_typeof(p_cart)<>'array' or jsonb_array_length(p_cart)<1 or jsonb_array_length(p_cart)>30 then raise exception 'السلة غير صالحة'; end if;
 select * into config from public.settings where id=1;
 for x in select * from jsonb_array_elements(p_cart) loop
   if jsonb_typeof(x)<>'object' or coalesce(x->>'id','') !~ '^[0-9a-fA-F-]{36}$' or coalesce(x->>'qty','') !~ '^[1-9]$' then raise exception 'محتويات السلة غير صالحة'; end if;
   select id,name,price into item from public.menu where id=(x->>'id')::uuid and available=true;
   if not found then raise exception 'أحد الأصناف لم يعد متاحاً'; end if;
   perday=perday+item.price*(x->>'qty')::integer;
   items=items||jsonb_build_array(jsonb_build_object('name',item.name,'price',item.price,'qty',(x->>'qty')::integer));
 end loop;
 n=case p_plan when 'week' then 5 when 'month' then 20 else 1 end;
 discount=case p_plan when 'week' then config.week_discount when 'month' then config.month_discount else 0 end;
 amount=round(perday*(100-discount)/100.0);
 select balance into bal from public.profiles where id=auth.uid() for update;
 if bal<amount*n then raise exception 'الرصيد التجريبي غير كافٍ'; end if;
 update public.profiles set balance=balance-amount*n where id=auth.uid();
 d=p_start;
 while i<n loop
  if extract(dow from d) not in (5,6) then
   insert into public.orders(parent_id,child_name,grade,section,items,day,amount,code) values(auth.uid(),childrow.name,childrow.grade,childrow.section,items,d,amount,lpad(floor(random()*1000000)::int::text,6,'0')) returning id into receipt;
   insert into public.transactions(parent_id,amount,kind,order_id) values(auth.uid(),-amount,'order',receipt); i=i+1;
  end if;
  d=d+1;
 end loop;
 return n;
end $$;
create function public.cancel_order(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
 if auth.uid() is null or public.my_role() is distinct from 'parent' then raise exception 'غير مصرح'; end if;
 select * into o from public.orders where id=p_id and parent_id=auth.uid() for update;
 if not found or o.status<>'active' or o.day<=(now() at time zone 'Asia/Kuwait')::date then raise exception 'يمكن إلغاء الطلبات القادمة فقط'; end if;
 update public.orders set status='cancelled' where id=o.id;
 update public.profiles set balance=balance+o.amount where id=auth.uid();
 insert into public.transactions(parent_id,amount,kind,order_id) values(auth.uid(),o.amount,'refund',o.id);
end $$;
create function public.set_delivery(p_id uuid,p_delivered boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.my_role(),'') not in ('canteen','admin') or p_delivered is null then raise exception 'غير مصرح'; end if;
 update public.orders set status=case when p_delivered then 'delivered' else 'active' end where id=p_id and status in ('active','delivered');
 if not found then raise exception 'الطلب غير موجود أو ملغى'; end if;
end $$;
revoke all on function public.demo_topup(integer),public.place_order(uuid,jsonb,text,date),public.cancel_order(uuid),public.set_delivery(uuid,boolean) from public,anon;
grant execute on function public.demo_topup(integer),public.place_order(uuid,jsonb,text,date),public.cancel_order(uuid),public.set_delivery(uuid,boolean) to authenticated;
commit;
