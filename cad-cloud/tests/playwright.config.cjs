const {defineConfig}=require('@playwright/test');
const path=require('node:path');
module.exports=defineConfig({testDir:'.',testMatch:'*.spec.cjs',timeout:60000,use:{baseURL:'http://127.0.0.1:4173',viewport:{width:1440,height:1100},screenshot:'only-on-failure'},webServer:{cwd:path.resolve(__dirname,'..'),command:'python3 -m http.server 4173 --directory ../services/cad-cloud --bind 127.0.0.1',url:'http://127.0.0.1:4173',reuseExistingServer:false}});
