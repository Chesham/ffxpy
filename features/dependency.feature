# language: zh-TW
功能: 外部依賴檢查
  使用者在執行 ffxpy 前，系統必須已安裝 ffmpeg
  
  場景: 找不到 ffmpeg 執行檔
    假如 我設定環境變數 "FFXPY_FFMPEG_PATH" 為 "/non/existent/path/ffmpeg"
    當 我執行指令 "ffx split input.mp4"
    那麼 輸出應該包含 "ffmpeg not found"
    並且 結束狀態碼應該為 1
