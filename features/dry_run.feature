# language: zh-TW
功能: Dry-run 模式
  使用者想要在實際執行轉檔前，先確認生成的 ffmpeg 指令是否正確

  場景: 使用 dry-run 執行切割指令
    假如 我執行指令 "ffx --dry-run -o dry_output.mp4 split {video_5s} --start 00:00:01 --end 00:00:02"
    那麼 輸出應該包含 "ffmpeg"
    並且 輸出應該包含 "-ss 0:00:01"
    並且 檔案 "dry_output.mp4" 應該不存在
    並且 結束狀態碼應該為 0
