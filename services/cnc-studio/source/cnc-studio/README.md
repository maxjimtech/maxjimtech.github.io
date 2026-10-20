# CNC Studio 0.1.0

本機網頁版 STEP → 製程工作單 → FANUC 風格 NC 草稿 → 3D／2D 刀路播放。

## 啟動

雙擊 `Start-CNC.cmd`，或執行：

```powershell
& './Start-CNC.ps1'
```

開啟 http://127.0.0.1:8788 。保留啟動視窗；按 Ctrl+C 關閉本程式。已在執行時直接開啟網址即可。`Start-CNC.ps1 -Port 8790` 可另選連接埠；`-NoBrowser` 不開啟瀏覽器。

不需 npm、不連外部 CDN，不上傳 STEP 至雲端。使用上一層 `cad_tools/config.json` 指定的 Python、FreeCAD 1.1 與共用 Laya。Laya 停用時不啟動、不呼叫；程式不修改任何持久開關。第一次模型推論可能需要較長時間。僅綁定 127.0.0.1，並檢查 Host 和 Origin。

## 操作

1. 載入範例，或匯入自己的 `.step`／`.stp`（Part 21，50 MB 以下）。範例是實際建立再重讀的 STEP，不是假造幾何。
2. 選取 FANUC 三軸母機範本與材料。要使用實際母機能力，取消「Laya 建議母機」後填行程、最高轉速與最大進給。目錄中的名稱代表能力範本，並非設備廠商認證。
3. 設素材尺寸、治具／模座、刀具與切深。此版要求素材 XY 已預加工為成品外形尺寸；素材底面與成品底面重合，只允許頂面餘量。G54 原點為成品包圍盒 Xmin/Ymin，成品頂面 Z0；依固定 +Z 刀軸加工，未自動尋找裝夾方向。
4. 治具選項用於記錄裝夾類型；選名稱不會自動建立治具。以 G54 座標輸入每個包絡盒 `[xmin,ymin,zmin,xmax,ymax,zmax]`。空陣列 `[]` 表示治具未驗證。通孔下方必須設計鑽孔讓位。
5. 規劃製程。Laya 真實選擇母機與 raster／contour 粗銑策略，幾何規則分解面銑、口袋與啄鑽工序。切速／每齒進給為目錄起始估值，依材料計算並受母機設定限制。每層切深取使用者設定與材料起始切深較小值。AI 不產生 G-code 字串，也不直接控制機台。
6. 若 Laya 信心低於中央門檻或輸入截斷，保留實際信心並阻擋下載；確認畫面中的母機與策略後，可點「已檢視並採用 Laya 的母機／策略建議」。此確認僅解除 AI 審查項目，不解除任何幾何或包絡阻擋。模型不可用時可修復服務，或明確取消本次 Laya、改用規則規劃；不冒稱模型成功。
7. 播放刀路，切換 3D、XY、XZ、YZ，拖曳旋轉及滾輪縮放。滑桿按估計刀路時間定位，快移黃色、進給青色，刀具與刀柄使用目錄尺寸。估時未含機台加減速、換刀、啄鑽停留、手動確認。
8. 下載 `.nc` 草稿或 JSON 工作單，或在頁面查看 G-code。修改任一加工參數會作廢舊刀路的下載連結，需重新規劃。JSON 包含來源 STEP SHA256、模型修訂、Laya 回傳、素材、設定、刀路及阻擋紀錄。資料留在 `data/`，程式不清除歷史檔案。

## 支援範圍與界限

- 單一有效封閉實體：矩形塊、頂開軸向矩形口袋、Z 向完整通孔。以「矩形塊減去辨識出的口袋與孔」重建，比對雙向體積差；未完整重建就僅供預覽並禁止自動 NC。
- 面銑、矩形口袋粗銑、配對鑽頭的分層啄鑽。範例刀庫 Ø6／Ø10 中心切削平底銑刀與 Ø12、118 度鑽頭。通孔延伸量需涵蓋鑽尖高度。擴充母機、材料、刀具與模座可編輯 `catalog.json`，重新啟動服務後生效；刀具需保持唯一 id／刀號及有效正值。
- 矩形口袋內角會保留刀具半徑殘料；沒有清角或精加工，不代表已加工成 STEP 最終形狀。未含攻牙、盲孔、斜孔、外輪廓、底面、車削、自由曲面、模仁加工或四／五軸。
- 治具檢查使用刀具／刀柄直立圓柱的保守矩形掃掠包絡與輸入盒作線段相交，會有保守誤報。刃長、素材、行程跨度另作數值檢查。未使用實際母機機械座標、運動學、夾持剛性或零件切削力。
- 3D／2D 是同一組 NC 刀位點的刀路播放；沒有逐步材料移除、切屑或完整機台／工件碰撞驗證。快速移動的圖形是線段示意，未模擬控制器各軸快移規則。
- FANUC 風格草稿包含 G21／G17／G90／G94／G40／G80、G54、T/M06、G43 H、主軸與冷卻，以及 G00／G01。換刀前 M00 要求操作員確認並手動到安全換刀位置；未假設機械原點或自動回零。頁面的換刀起點與完整動作未建模。
- 沒有實機適配、控制器執行測試或製造放行。需依實際母機廠手冊核對換刀、G54、刀長補正、有效加工範圍、冷卻及後處理器，再作離線驗證與現場空跑。

FANUC 功能參考：[FANUC CNC Function Catalog](https://www.fanucamerica.com/docs/default-source/cnc-files/cnc-function-catalog.pdf)。G-code 模態與刀長概念亦參閱 [LinuxCNC G-code Reference](https://www.linuxcnc.org/docs/html/gcode.html)；LinuxCNC 參考不等於 FANUC 母機認證。

## 驗證與架構

`server.py` 為 Python 標準庫 HTTP API；`cad_worker.py` 在獨立 FreeCAD 程序內重用中央 `step_audit.audit_step_shape`，只新增 CNC 特徵辨識；`cam.py` 依限制計算刀位；`web/` 為無外部依賴網頁。中央 Laya 1.1.0 新增 `/decide`，沿用同一套本機模型與服務，舊 `/route` 不變。

從本目錄執行：

```powershell
$cfg=Get-Content '../cad_tools/config.json' -Raw | ConvertFrom-Json
$pythonExe=[Environment]::ExpandEnvironmentVariables($cfg.runtimes.python)
& $pythonExe -B tests/test_cam.py
& 'C:/Program Files/FreeCAD 1.1/bin/python.exe' -B tests/test_cad.py
# 先開啟服務，再執行真實 STEP 上傳、Laya 推論、低信心確認與 NC 下載驗證
& $pythonExe -B tests/http_acceptance.py
```

`reports/` 保存實測紀錄、測試 STEP、NC 草稿與來源參照。啟動應用不會執行 NC，也沒有連線到控制器的功能。此套件依賴本機中央環境，搬到其他電腦時需另行安裝與設定 FreeCAD、Python 及 Laya；交付不包含其大型 runtime 或模型。
