# RD065 CAD Cloud 2.1.0

線上入口：https://maxjimtech.github.io/services/cad-cloud/

GitHub Pages 提供可安裝網頁；GitHub 託管 Windows runner 執行 FreeCAD。使用端不安裝 Python／FreeCAD、不啟動本機 CAD。瀏覽器僅輸入條件、顯示結果與下載檔案。

## 免登入與精簡引擎修訂

獨立後端已部署至 https://rd065-cad-guest.vercel.app/api/cad ，公開健康檢查回覆 mode=guest、configured=false、daily_limit=4、timezone=Asia/Taipei。尚缺管理端 CAD_GITHUB_TOKEN，不能啟動生成。設定後還須通過實際匿名提交、CAD 驗收與下載，才在 deployment.json 啟用 guest_api。訪客不需 GitHub 帳號或權杖。

精簡版使用官方1.1.3二進位，在雲端移除無關工作台，不啟動GUI；保留OCC、Qt及TechDraw相依程式庫。這不是重新編譯的最小FreeCAD，初次仍下載官方完整封裝。每次執行記錄移除工作台與實際磁碟大小，並檢查Part／Sketcher／Spreadsheet／TechDraw能載入。

## 使用

1. 用 Safari、Chrome 或 Edge 開啟線上入口。
2. 目前入口顯示「免登入生成準備中」，待後端憑證及雲端 CAD 驗收完成才開放生成。
3. 開放後填寫需求、點「在雲端生成」，訪客不需連線設定或權杖。
4. 關閉頁面不會中止 GitHub 工作；同一瀏覽器保留工作編號，可重新開啟查詢。
5. 完成後載入模型與圖面，或前往該工作 Release 下載 CAD-delivery.zip。失敗工作保留紀錄，不能視為合格模型。

iPhone／iPad：Safari → 分享 → 加入主畫面。Chrome／Edge 可用瀏覽器安裝功能。安裝的僅是網頁外殼；沒有網路就不能建模。

全站每日最多申請生成4次，台灣時間午夜重置；已保留額度的失敗申請亦計次。需要增加使用次數，請聯絡0931675001。管理端憑證設定方式見 server/README.md；不要把權杖貼到聊天或原始碼。

## 部署位置

- `services/cad-cloud/`：網頁、PWA、條件範本。
- `cad-cloud/engine/`：既有 FreeCAD 原生建模核心的發行來源。
- `cad-cloud/cloud/`：輸入驗證、雲端建模連接及成果發布。
- `cad-cloud/tests/`：雲端條件／桌面／手機瀏覽器檢查。
- `.github/workflows/cad.yml`：GitHub 託管 Windows CAD 工作。
- `.github/workflows/cad-cloud-checks.yml`：GitHub 託管 Linux 網頁檢查。

沿用此網站既有的 main 分支 Pages 發布；不要切換成只發布 CAD 的 Pages 工作流程，以免其他網站內容消失。原首頁與其他服務保持原樣。

相關 `main` 引擎／工作流程更新會執行一次預設 RD065 建模；一般需求由網頁透過 workflow_dispatch 提交。每次工作期限 90 分鐘。等待排程、安裝與曲面生成需要時間；執行額度與儲存依 GitHub 帳號方案。

## 成果與保存

- FCStd 原生特徵、STEP 三種零件與整組組立、四張 DXF、圖面 PNG、3D 網格預覽。
- 需求、BOM、原生尺寸讀值、實體／STEP／靜態干涉驗證及 SHA256 清單。
- 完整 ZIP 作 CRC 檢查，存放在獨立 GitHub Release。
- `cad-results` 分支保存結果 JSON、圖面及實際保存後 STEP 的三角網格；不以預畫示意圖代替 CAD。
- Actions Artifact 保留 30 天，Release 和結果分支需由管理者定期清理。

此儲存庫公開，程式、凸輪剖面資料與結果預覽也公開。未上傳原始 DWG／DFT 或其他專案歷史檔案。

## 執行環境與驗證邊界

FreeCAD 官方 1.1.3，雲端下載7z後核對官方SHA256。最新重疊刀具及有記錄的fuzzy布林重試已通過14段溝槽、兩側C0.5和靜態零干涉；後續在Assembly.step重匯入檢查失敗，仍不可當作成功交付。正在以保存的雲端產物診斷STEP轉檔。實際首跑結論以 GitHub Actions 及成功結果 JSON 為準，不能以舊本機驗收代替。

RD065 單頭等速家族：傳動比等於滾子數，沿用固定輔助孔與軸端段落。預設滾子外徑14、凸輪外徑50／根徑32／C0.5、20:1、PCD136、軸距65。

仍屬設計審查模型：主要關聯尺寸不等於全部加工尺寸；實體螺紋牙、軸承內部、全套配合／粗糙度／公差與全週期動態驗證未完成。生成幾何、網頁與下載成功不等於製造放行。

[工作流程 API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) · [官方 FreeCAD 1.1.3](https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.3)
