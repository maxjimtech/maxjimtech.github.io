// These tests execute only in GitHub's hosted Linux runner. Mocked API fixtures
// check UI behavior; they do not substitute for the real FreeCAD cloud first run.
const {test,expect}=require('@playwright/test');
// API fixtures must not be bypassed by a previously installed service worker.
test.use({serviceWorkers:'block'});

test('guest submits without login or browser credential and polls after reload',async({page})=>{
  let submitted,posts=0,healthCalls=0,statusCalls=0;
  await page.route('**/deployment.json',r=>r.fulfill({json:{repository:'maxjimtech/maxjimtech.github.io',branch:'main',guest_api:'https://api.github.com/guest-cad'}}));
  await page.route('https://api.github.com/**',async route=>{
    const request=route.request(),u=new URL(request.url());
    expect(request.headers().authorization).toBeUndefined();
    if(u.pathname!=='/guest-cad')return route.fulfill({status:404,json:{message:'Not Found'}});
    if(request.method()==='POST'){
      submitted=request.postDataJSON();posts++;
      return route.fulfill({status:202,json:{job_id:submitted.job_id,status:'submitted'}});
    }
    if(u.searchParams.has('job')){statusCalls++;return route.fulfill({json:{job_id:u.searchParams.get('job'),status:'in_progress'}});}
    healthCalls++;return route.fulfill({json:{mode:'guest',configured:true}});
  });
  await page.goto('/');
  await expect(page.locator('#banner')).toContainText('無需登入');
  await expect(page.locator('#settings')).toBeHidden();
  await page.locator('#submit').click();
  await expect(page.locator('#banner')).toContainText('已提交');
  await expect(page.locator('#connection')).not.toBeVisible();
  expect(posts).toBe(1);expect(submitted.requirements.cam_root_mm).toBe(32);
  expect(submitted.requirements.roller_od_mm).toBe(14);
  await page.reload();
  await expect(page.locator('#jobs')).toContainText('雲端運算中');
  expect(healthCalls).toBeGreaterThan(1);expect(statusCalls).toBeGreaterThan(0);
  expect(await page.evaluate(()=>localStorage.getItem('cad-cloud-connection'))).toBeNull();
  await page.screenshot({path:'test-results/guest-submit.png',fullPage:true});
});

test('unconfigured guest endpoint cannot fall back to asking visitor for a token',async({page})=>{
  await page.route('**/deployment.json',r=>r.fulfill({json:{repository:'maxjimtech/maxjimtech.github.io',branch:'main',guest_api:'https://api.github.com/guest-cad'}}));
  await page.route('https://api.github.com/guest-cad',r=>r.fulfill({json:{mode:'guest',configured:false}}));
  await page.goto('/');await expect(page.locator('#banner')).toContainText('尚未設定');
  await page.locator('#submit').click();await expect(page.locator('#banner')).toContainText('尚未就緒');
  await expect(page.locator('#connection')).not.toBeVisible();
});
test('connect, submit real request shape, remember job and clear token',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let submitted;
  await page.route('https://api.github.com/**',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    let body={};let status=200;
    if(p==='/repos/test/cad')body={permissions:{push:true},default_branch:'main'};
    else if(p.endsWith('/workflows/cad.yml'))body={id:42};
    else if(p.endsWith('/dispatches')){submitted=route.request().postDataJSON();status=204;}
    else if(p.endsWith('/runs'))body={workflow_runs:[]};
    else {status=404;body={message:'Not Found'};}
    await route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto('/');
  await expect(page.locator('#field-roller_od_mm')).toHaveValue('14');
  await page.locator('#settings').click();
  await page.locator('#repository').fill('test/cad');
  await page.locator('#token').fill('test-token-never-persist');
  await page.locator('#connect-button').click();
  await expect(page.locator('#connection')).not.toBeVisible();
  await page.locator('#submit').click();
  await expect(page.locator('#banner')).toContainText('已提交');
  expect(submitted.ref).toBe('main');
  const c=JSON.parse(submitted.inputs.requirements);
  expect(c.cam_root_mm).toBe(32);expect(c.roller_od_mm).toBe(14);expect(c.require_dwg).toBe(false);
  expect(submitted.inputs.job_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('test-token-never-persist');
  expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  await page.reload();await page.locator('#submit').click();
  await expect(page.locator('#connection')).toBeVisible();
});
test('mismatched ratio never submits a cloud job',async({page})=>{
  await page.goto('/');
  await page.locator('#field-ratio').fill('19');
  // Without login, the form requests a connection, not a local CAD executable.
  await page.locator('#submit').click();
  await expect(page.locator('#connection')).toBeVisible();
});
test('published site opens on desktop and phone',async({page})=>{
  test.skip(!process.env.CAD_LIVE_URL,'Only verify production after deployment');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.CAD_LIVE_URL);
  await expect(page.locator('#field-ratio')).toHaveValue('20');
  await expect(page.locator('#field-roller_od_mm')).toHaveValue('14');
  await page.locator('#install').click();
  await expect(page.locator('#banner')).toContainText('加入主畫面');
  await page.screenshot({path:'test-results/published-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/published-phone.png',fullPage:true});
  expect(errors).toEqual([]);
});
