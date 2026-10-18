// Real production browser test. It submits ONE job under the ordinary daily quota.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Use a GitHub-hosted runner.');
const site='https://maxjimtech.github.io/services/cad-cloud/';
const api='https://rd065-cad-guest.vercel.app/api/cad';
const out='test-results/live';fs.mkdirSync(out,{recursive:true});
const report={started_at:new Date().toISOString(),site,api,requests:[],submitted:false};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block'});
const page=await context.newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().startsWith(api)){
  assert.equal(r.headers().authorization,undefined);
  report.requests.push({method:r.method(),url:r.url()});
}});
try{
  // Wait for branch-based Pages to serve the exact enabled configuration.
  for(let attempt=0;attempt<40;attempt++){
    const r=await fetch(site+'deployment.json',{cache:'no-store'});
    if(r.ok&&(await r.json()).guest_api===api)break;
    if(attempt===39)throw Error('Production guest endpoint was not published.');
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  await page.goto(site);await expect(page.locator('#settings')).toBeHidden({timeout:30000});
  await expect.poll(()=>page.locator('#banner').innerText(),{timeout:60000}).toMatch(/無需登入|已載入/);
  await expect(page.locator('#submit')).toBeEnabled();
  await expect(page.locator('#field-cam_root_mm')).toHaveValue('32');
  await expect(page.locator('#field-roller_od_mm')).toHaveValue('14');
  const submitted=page.waitForResponse(r=>r.url()===api&&r.request().method()==='POST',{timeout:45000});
  await page.locator('#submit').click();const response=await submitted;
  const initial=await response.json();assert.equal(response.status(),202,JSON.stringify(initial));
  report.job_id=initial.job_id;report.submitted=true;save();
  await expect(page.locator('#connection')).not.toBeVisible();
  await page.reload();
  const row=page.locator('.job').filter({hasText:initial.job_id.slice(0,8)});
  await expect(row).toBeVisible({timeout:30000});
  await page.screenshot({path:out+'/submitted-after-reload.png',fullPage:true});
  const deadline=Date.now()+110*60*1000;let result;
  while(Date.now()<deadline){
    const r=await fetch(api+'?job='+initial.job_id,{cache:'no-store',signal:AbortSignal.timeout(30000)});
    assert.equal(r.status,200);result=await r.json();
    if(result.status==='completed')break;
    if(['failed','cancelled'].includes(result.status))throw Error('CAD job '+result.status+': '+JSON.stringify(result));
    console.log('CAD_PROGRESS',initial.job_id,result.status,result.run_url||'');
    report.last_status=result;save();await new Promise(resolve=>setTimeout(resolve,60000));
  }
  assert.equal(result?.status,'completed','Generation did not complete before the test deadline.');
  report.result=result;save();
  await page.locator('#refresh').click();await expect(row).toContainText('完成',{timeout:30000});
  await row.getByRole('button',{name:'載入模型與圖面'}).click();
  await expect(page.locator('#banner')).toContainText('已載入',{timeout:120000});
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#metrics')).toContainText('22');
  await page.screenshot({path:out+'/model-desktop.png',fullPage:true});
  await page.locator('[data-tab="drawings"]').click();
  for(const name of ['AssemblyDrawing','CamDrawing','PlateDrawing','RollerDrawing']){
    await page.locator('#drawing-select').selectOption(name);
    await expect(page.locator('#drawing')).toBeVisible({timeout:60000});
    await expect.poll(()=>page.locator('#drawing').evaluate(el=>el.complete&&el.naturalWidth>0),{timeout:60000}).toBe(true);
    await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:out+'/phone.png',fullPage:true});
  await expect(row.getByRole('link',{name:'下載 FCStd／STEP／DXF'})).toHaveAttribute('href',result.release_url);
  const download=await fetch(result.download_url,{signal:AbortSignal.timeout(180000)});
  assert.equal(download.status,200);const zip=Buffer.from(await download.arrayBuffer());
  const sha=createHash('sha256').update(zip).digest('hex');assert.equal(sha,result.package_sha256);
  fs.writeFileSync(out+'/CAD-delivery.zip',zip);report.download={bytes:zip.length,sha256:sha};
  assert.deepEqual(errors,[]);report.status='BROWSER_SUBMIT_RELOAD_PREVIEW_DRAWINGS_DOWNLOAD_PASS';save();
  console.log(report.status,report.job_id,sha);
}catch(error){report.error=String(error);report.status='FAILED';save();await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();}
