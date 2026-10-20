# CNC Studio · GitHub 網頁發布包 0.1.1

線上網址：https://maxjimtech.github.io/services/cnc-studio/

此 GitHub Pages 頁提供可操作的合成範例刀路播放器：3D 旋轉／縮放、XY/XZ/YZ 投影、播放／暫停、速度／進度控制、工序列表、NC 草稿與工作單下載。

**線上頁播放預先計算的範例，未載入 Laya，也不接收任意 STEP 或重新規劃。** 要匯入自己的 STEP、設定母機／素材／材料／治具／刀具、呼叫 Laya 並重新產生 NC，請下載 [完整原始碼](source.zip)，依 [啟動說明](source/SETUP.md) 啟動 Python/FreeCAD 後端，或使用已安裝的 http://127.0.0.1:8788 。

- [完整應用原始碼](source/cnc-studio/)
- [共用 CAD/Laya 來源](source/cad_tools/)
- [本機操作與支援界限](source/cnc-studio/README.md)
- [FANUC 範例 NC 草稿](sample.nc)

公開內容僅為程式與合成範例；沒有使用者上傳檔、登入資料、客戶模型或大型模型/runtime。完整應用核心沿用 0.1.0，發布包為 0.1.1。僅支援三軸矩形口袋粗銑、面銑與配套垂直通孔，未支援多軸／曲面精加工。NC 未經實際母機驗證，不可直接上機。
