# CNC Studio Browser 0.2.0

https://maxjimtech.github.io/services/cnc-studio/

以 HTML、JavaScript 與 OpenCascade WebAssembly 在瀏覽器處理 STEP、計算三軸 2.5D 粗加工刀路、匯出 FANUC 風格 NC 草稿及播放 3D／XY／XZ／YZ 刀路。不需 Python、FreeCAD、本機服務或雲端計算 API。

## 使用

1. 使用近期桌面版 Chrome、Edge 或 Firefox 開啟上述 HTTPS 網址。第一次匯入會下載約 13.7 MB 的壓縮幾何核心，解壓後為 65.9 MB WASM；記憶體需求高於下載大小，未對手機承諾相同表現。
2. 載入範例或選取自己的 `.step`／`.stp`，最大 50 MB。檔案留在瀏覽器記憶體，不會提交至 GitHub 或後端。例外：你自行把 STEP 加入 GitHub 儲存庫屬於另外的公開上傳行為，此頁沒有這項功能。
3. 固定 +Z 為刀軸；原始形狀會在顯示座標轉至成品包圍盒 Xmin/Ymin 與頂面 Z0。原 STEP 不改寫。支援單一有效實體，且須可由矩形塊減去頂開矩形口袋與 Z 向通孔精確重建。
4. 設定材料、素材、治具／模座、刀具、切深與步距。素材 XY 必須已預加工至成品尺寸；素材底面與成品底面重合，只處理頂面餘量。此版不加工外輪廓及底面。
5. 可按行程容量規則自動選取最小適用母機範本；取消自動選擇後可手動填行程、最高轉速、進給限制。這是數值規則，不是 AI 推論，也不是特定母機適配證明。
6. 規劃後可播放、調速、拖動進度、旋轉／縮放 3D、切換 XY/XZ/YZ、顯示／隱藏素材與刀路，並下載 NC 及 JSON 工作單。修改參數或匯入新模型會作廢舊 NC Blob 連結。
7. 治具使用 G54 包絡盒 `[xmin,ymin,zmin,xmax,ymax,zmax]`；空陣列代表未驗證治具。檢查為保守的刀具／刀柄掃掠包絡相交，不是完整機台碰撞。可按「取消運算」終止 Worker。

## Laya 的實際狀態

**此版沒有載入 Laya，也沒有執行瀏覽器 Laya 推論。** UI 保持未驗證／未載入狀態，使用幾何與數值規則完成加工工作單。

已查閱原專案的 [laya-ts 瀏覽器 ONNX 路線](https://github.com/NandhaKishorM/laya/blob/main/laya-ts/README.md)。它需要另外的 ONNX 模型、tokenizer、校準設定及瀏覽器 runtime；現有 Python 模型不能直接嵌入 HTML。本輪沒有轉換、下載或替換既有的本機模型，也沒有修改中央 Laya 開關。公開 ONNX 轉換版本不等於本機固定修訂與 CNC 數據校準的驗證。本版暫不提供未經測試的模型啟用按鈕。

## 支援範圍與輸出限制

- 真正的 WASM STEP／BREP 讀取、單實體有效性、解析面特徵與布林重建體積差檢查。渲染網格不參與 NC 支援判定。超過支援範圍的形狀僅供預覽或回報錯誤，不套用範例刀路。
- 面銑、矩形口袋粗銑（往復或等距＋中心清除）、配套鑽頭的啄鑽。刀庫目前為 Ø6／Ø10 中心切削平底銑刀與 Ø12、118 度鑽頭；其他通孔尺寸沒有配套鑽頭時阻擋輸出。
- 未含自由曲面、盲孔、攻牙、斜孔、外輪廓、清角、精加工、四／五軸與車削。口袋角落保留刀具半徑殘料。切速與進給為起始估值。
- 刀路與 NC 共用同一組刀位點；未模擬材料移除、切屑、切削力、完整機台或換刀動作。估時不含換刀、加減速或人工停留。
- FANUC 草稿包含 G54、T/M06、G43 H、G00/G01、主軸及冷卻。換刀前 M00 要求人工確認安全位置。母機座標、偏置及後處理仍須個別驗證，不能直接上機。
- 保留原本 Python 後端來源於 [source/](source/)；保留先前預計算示範於 [legacy-0.1.1/](legacy-0.1.1/)。兩者的能力與本瀏覽器版不同。

## 架構與原始碼

`index.html`、`app.mjs`、`style.css` 為介面；`runtime.mjs` 與 `engine-worker.mjs` 管理工作；`kernel.mjs` 執行 BREP 支援檢查；`cam.mjs` 計算粗加工與 NC；`occt-loader.mjs` 載入同目錄內的固定版本資產，解壓縮後核對 SHA256。

`vendor/occt.mjs` 與 `vendor/occt.wasm.gz.*` 來自 npm `opencascade.js@1.1.1`，OCCT 7.4。WASM 使用可重建的 gzip 分段儲存，並非外部 CDN 依賴。`vendor/occt.LICENSE.txt` 保留原授權；參考 [上游來源與說明](https://github.com/donalffons/opencascade.js)。壓縮與分段不修改核心內容。

下載 GitHub 網站 ZIP 後，本程式位於 `services/cnc-studio/`。因為 Worker、模組與 fetch 的瀏覽器規則，請使用 HTTPS 網站或靜態 HTTP 伺服器，不以 `file://` 雙擊。Windows 靜態伺服器須將 `.mjs` 回傳為 JavaScript MIME，不能回傳 text/plain。

## 本輪驗證

- 14 項 JavaScript CAM 檢查：刀路／NC 刀位一致、快移高度、治具掃掠、素材、刀具、材料、鑽尖、行程與不支援形狀。
- 7 項 WASM 幾何檢查：第二份 80×60×18 mm 平移工件支援、球體／盲孔／凸台／多實體／開放面阻擋，同一 WASM 程序釋放後重讀三次。
- 6 組材料／刀具與原 Python CAM 的全部刀位、進給及估時比對通過。
- 實際瀏覽器 Worker 載入與兩份 STEP 讀取、材料／刀具重算、修改後作廢舊輸出、治具碰撞阻擋與下載驗證。此類驗證不代表母機或實體加工驗證。
