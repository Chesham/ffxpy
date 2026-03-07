# language: zh-TW
功能: 檢查版本資訊
  使用者想要檢查 ffxpy 的版本以確認安裝正確

  場景: 顯示版本號
    假如 我執行指令 "ffx --version"
    那麼 輸出應該包含 "ffxpy version"
    並且 結束狀態碼應該為 0
