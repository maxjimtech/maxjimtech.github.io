# 免登入雲端後端

瀏覽器不持有權杖。`api/cad.mjs` 部署在有權限的雲端後端，呼叫 `cad-cloud/server/guest.mjs`；FreeCAD 仍在 GitHub 託管執行器執行。

管理端一次設定（不要寫進原始碼）：

- `CAD_GITHUB_TOKEN`：僅此儲存庫的 Actions 讀寫、Contents 讀寫。Contents 寫入用於專用 `cad-control` 分支的原子配額，不由使用者指定檔案路徑。
- `CAD_DAILY_LIMIT=6`：全站每日最多6組。
- `CAD_COOLDOWN_SECONDS=300`：全站兩次提交至少間隔5分鐘；有排程或執行中的 CAD 時暫不受理新工作。

`cad-control/rate-limit.json` 使用 GitHub Contents SHA compare-and-swap 保留預算，防止多個後端執行個體同時超額。相同工作編號與條件重送不重複啟動。派送失敗仍占用一次預算，交由管理者查核；不能用反覆失敗取得無限雲端執行。

配額是公開服務的共用上限，不是真人證明或私人使用者識別。Origin 限制不代替原子配額。IP 僅以伺服端憑證 HMAC 後的值記錄，不存原始 IP。

部署後確認 `GET /api/cad` 回覆 configured=true，才把真實後端 HTTPS URL 填入網頁 `deployment.json` 的 `guest_api`。未部署或未授權不能宣稱免登入生成已啟用。不能將權杖放入這個 JSON。
