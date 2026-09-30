# 小宇哥漁場排行榜安全修補

## 現況與上線狀態

檢查基準：main `15ad721beec763e0825e63cb12d7c89bcbb8415c`，2026-09-30。

舊 API 接受任意 0–100000 整數，沒有工作階段、重放防護或共享限流；每次入榜以伺服端 GitHub 憑證 PUT main。原 CORS 只影響瀏覽器，沒有在處理器拒絕錯誤來源，也擋不住自行設定 Origin 的 HTTP 客戶端。

儲存庫沒有 Redis/KV 依賴、連線設定或其他資料服務。已連接的 Vercel 專案是 `xiaoyuge-score-api`，Node 24；公開穩定網域是 `xiaoyuge-score-api.vercel.app`。目前工具能讀專案資料，但不能列出環境變數或已安裝資料服務，故不能宣稱正式環境一定沒有 Redis，也沒有擅自建立帳號、服務或金鑰。

此修補分支尚未合併／正式部署。API 不再需要 GITHUB_TOKEN。沒有可用 Redis 設定時，GET 讀取部署內的歷史 JSON，所有 POST 回 503，遊戲仍可遊玩並保留本機紀錄。這是刻意拒絕不受保護的線上寫入；不是已完成持久化限流的部署。

## 分數推導

遊戲結束值是 `max(0, round(score + fish*2 + weight*0.5))`。20 天最多：

| 來源 | 保守上界 |
| --- | ---: |
| 每天兩次成功餵食 | 40 × 12 = 480 |
| 每天一次換水 | 20 × 5 = 100 |
| 每日餵食／健康獎勵 | 20 × (5 + 12) = 340 |
| 存活魚數 | 100 × 2 = 200 |
| 體重 | (20 + 40 × 13) × 0.5 = 270 |
| 水車 A 次 | 至多 6 × A |

所以 `finalScore <= 1390 + 6*A` 是保守上界，不代表該上界可實際達成。缺氧、溫度、沒餵食的扣分只會降低分數。

**原玩法沒有固定最高分**：水車接近飽和後仍每次加 1 分且可無限操作。任意設定「真正最高分 1000／2000」會排除原本合法玩法。本修補先檢查上述依操作數而定的上界，再以伺服端完整重播計算分數，要求送來的數字完全一致；不接受字串、null、浮點、負數或不安全整數。

線上資格採 15 分鐘工作階段、最多 10000 個有效操作、起始 20 個操作額度加每秒 20 個的寬鬆節奏檢查。依此最寬鬆總分上界為 61390，實際通常遠低於此。這些是送分及運算資源限制，沒有修改遊戲按鈕、獎勵、天數、畫面或等級；超時、超量的遊戲仍可玩完及本機暫存，但不能線上入榜。若必須讓數小時或無限水車操作也可入榜，需要重新選擇服務資源政策，而不能假造有限的遊戲最高分。

## 工作階段、nonce 與重放

開始遊戲時 POST `{action:"session"}`，伺服端產生 256-bit 不透明 nonce 及隨機遊戲 seed。Redis 只保存 nonce 的 SHA-256 摘要，工作階段內含 seed、發行時間、來源及 HMAC 化的 IP，EX 900 秒、NX 建立。nonce 只放前端記憶體，不放 URL 或 localStorage；不需要另加簽章秘密。

只將**遊戲邏輯**的 Math.random 改為相同分布用途的可重播 PRNG，動畫仍使用原本隨機。操作紀錄包含有效餵食 f、水車 a、換水 w、下一天 n，無效多餵／換水及純查看不記錄。伺服端逐步套用原溶氧、溫度、鹽度、事件、損失與計分規則，檢查完成遊戲才接受結果。

Redis Lua 在同一原子操作中確認工作階段仍完全一致、更新 Top10／最高分及刪除 nonce。並行或跨執行個體重送只有一筆成功，其餘 409；nonce 到期、IP 或 Origin 改變也拒絕。若寫入成功但網路回覆遺失，重送仍拒絕以避免重複入榜，可重新 GET 排行榜核對。

這不是真人證明或完整反作弊：seed 與前端程式公開，攻擊者可在取得有效工作階段後模擬合法軌跡並等待節奏檢查。限流限制其規模；CORS/Origin 只提供瀏覽器來源隔離，非認證。若未來需要競賽級公平性，可追加登入、挑戰或伺服端逐步遊戲狀態；不在此次無畫面修改的範圍。

## 持久化限流

所有來源已允許的 POST（含 session、格式錯誤與重放）共用預算；先限流才驗證 payload 或建立 nonce。Redis Lua INCR／EXPIRE 原子計數，每個 IP 每個固定分鐘最多 12 次，全站每個固定分鐘最多 120 次；限流資料 TTL 120 秒，429 帶 Retry-After。固定分鐘在邊界可能容許相鄰兩分鐘的突發額度，並非滑動視窗。

Vercel 只使用平台的 `x-vercel-forwarded-for`，不取客戶端提供的任意自訂 IP 或第一個逗號分隔值；若該值不是單一合法 IP 就拒絕。非 Vercel 本機使用 socket.remoteAddress。IP 使用 Redis 憑證作 HMAC 鹽，不保存原始地址；更換 Redis 憑證會令既有工作階段綁定失效。預覽與 production 使用不同 Redis key prefix，避免預覽污染正式榜。

Redis 缺少、斷線、逾時、錯誤時一律拒絕 POST；没有記憶體、/tmp 或 Git commit 降級寫入。GET 不支援 Redis 故障時的自動回退，以免顯示陳舊線上資料為最新榜；前端依既有失敗行為顯示本機資料。GET 本身不建立 nonce、沒有 GitHub 請求，仍可加 Vercel WAF 做更外層的流量保護。

## 最小遷移與部署

建議停止用 Git commit 當排行榜資料庫：寫入內容權限過大、併發 SHA 衝突會遺失合法更新，每筆分數建立版本歷史與可能的部署，亦無法原子處理 nonce／限流／排行榜。本修補只需一個 Redis：短期 session／rate keys 使用 TTL；board key 永久保存一份 Top10 JSON。選擇有持久化保障的資料庫方案並維持備份，不要用可隨意逐出 board key 的快取配置。

1. **先撤銷舊 API 的 GitHub PAT／存取憑證，再處理舊 Vercel 部署。** 只從新版程式移除或刪除專案環境變數，不會讓舊部署內的有效憑證失效。舊部署網址可能仍可被直接呼叫；停用、刪除或保護舊部署，並核對舊送分端點不能再寫 main。本修補沒有代替使用者撤銷任何共用憑證。
2. 合併修補，將同一 Vercel 專案部署為新版。若 Git 整合未啟用，需在 Vercel 接上該 repository 或從其 checkout 部署；不能假設 PR 自動代表 API 已上線。先無 Redis 部署也可阻止不受保護寫入，代價是線上送分暫停。
3. 若已有可用 Redis，重用並確認 namespace／權限／方案；否則在自己的 Vercel Marketplace／Upstash 建立一個資料庫。**外部設定僅兩個伺服端環境變數**：UPSTASH_REDIS_REST_URL、UPSTASH_REDIS_REST_TOKEN。透過 Vercel 安全介面輸入，絕不寫入 score-config.js、repo、聊天或命令列。缺少任一值就不啟用送分。更換環境變數後重新部署。
4. 人工核實既有 scores.json（舊資料無工作階段，不能宣稱已驗證）。如需匯入，在安全本機環境先設定兩個環境變數，再執行：`VERCEL_ENV=production node scripts/import-score-board.mjs xiaoyuge/scores.json`。腳本驗證格式並 SET NX，既有榜永不覆寫；不輸出秘密。若不匯入，第一筆合法送分以部署內快照初始化。本次來源快照為空榜。
5. 先在預覽環境確認 GET、session、合法送分、同 nonce 重送 409、13 次同 IP POST 第 13 次 429，再正式部署。工作階段應在遊戲開始取得；不要使用舊只含 name/score 的客戶端。兩個遊戲目錄均已同步且更新 script cache 版本。
6. 正式驗收須另確認實際 Redis 設定、資料持久性、穩定域名指向新版、舊憑證失效。未設定外部服務或尚未部署時，不能聲稱線上排行榜已完成修補。

localhost 預設不允許；只有明確設定 SCORE_ALLOW_LOCALHOST=true 的開發環境允許精確 localhost/127.0.0.1 的 http Origin。格式不完整或混入其他網域的前綴不會通過。64 KiB payload、錯誤資訊通用化、no-store、nosniff 也已加入。

## 驗證

`node tests/score.test.mjs`：11 項測試包含合法送分、超高／型別偽造、錯誤或缺少來源、重放／並行重放、跨 handler 限流、session 濫用、過期與 IP 綁定、資料服務缺少或故障、錯誤 JSON／超量／未完成遊戲、Vercel IP 路徑、REST 命令形狀，以及 30 個 seed 的真實前端與伺服端重播一致性。

`REDIS_TEST_PORT=6379 node tests/score-redis.test.mjs`：只接 localhost 的測試 Redis，另 3 項實測涵蓋共享 IP／全站限流、TTL、NX、Lua 原子 nonce 消耗、並行送分不遺失更新、過期與工作階段不一致不寫榜。Unix socket 可用 REDIS_TEST_SOCKET；沒有指定測試連線時明確 skip。GitHub Actions 啟動獨立 Redis 7.4 並跑兩組測試，無正式環境憑證。

參考：

- https://upstash.com/docs/redis/features/restapi
- https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval
- https://vercel.com/docs/headers/request-headers
- https://vercel.com/docs/project-configuration/vercel-json
