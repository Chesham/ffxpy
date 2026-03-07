# language: zh-TW
功能: 輸入檔案驗證
  為了避免轉檔失敗，ffxpy 應該在執行前驗證輸入檔案與時間範圍

  場景: 設定的結束時間超出影片長度
    假如 我執行指令 "ffx -o output.mp4 split {video_5s} --end 00:00:10"
    那麼 輸出應該包含 "end time"
    並且 輸出應該包含 "out of range"
    並且 結束狀態碼應該為 1

  場景: 設定的開始時間大於結束時間
    假如 我執行指令 "ffx -o output.mp4 split {video_5s} --start 00:00:04 --end 00:00:02"
    那麼 輸出應該包含 "start time"
    並且 輸出應該包含 "must be less than"
    並且 結束狀態碼應該為 1
