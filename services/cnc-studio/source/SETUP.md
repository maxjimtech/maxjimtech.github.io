# 完整網頁程式啟動

此套件包含 Python 後端、HTML/JS/CSS 與共用 CAD/Laya 來源。GitHub Pages 本身只提供範例播放，完整功能需有 Python、FreeCAD 與可選的 Laya 服務。

1. 解壓縮並保持 `cnc-studio/` 與 `cad_tools/` 並列。
2. 安裝 Python 3 與 FreeCAD 1.1，將 `cad_tools/config.example.json` 複製為 `cad_tools/config.json`，填入兩個 Python 執行檔的完整路徑。FreeCAD 必須使用其內含的 `bin/python.exe`，不能以一般 Python 代替。
3. 在 `cnc-studio/` 執行 `Start-CNC.cmd`，開啟 http://127.0.0.1:8788 。也可在該目錄使用設定的 Python 執行 `python -B server.py`。
4. 範例設定預設不載入 Laya，可先使用確定性粗加工規劃。若已有中央 `cad_tools`，應直接重用既有環境與設定；不覆寫原設定或重複下載模型。
5. Laya 為可選後端，需依原共用環境規格安裝至 `cad_tools/runtime/laya`，並提供設定中固定版本的模型快照。設定 `laya.enabled=true` 前先驗證模型可用。模型與大型 runtime 未包含於此 ZIP；不要把 API 金鑰或模型快取提交至 GitHub。

原有 CNC Studio 工作區的使用者，直接執行原專案 `Start-CNC.cmd` 即可，不必以本套件替換中央工具。NC 仍為 FANUC 風格 2.5D 粗加工草稿，尚未作母機適配、材料移除或物理驗證。
