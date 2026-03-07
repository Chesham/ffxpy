# language: zh-TW
功能: 切割影片
  使用者想要將影片檔案切割成較小的片段

  場景: 基本影片切割
    假如 我執行指令 "ffx -o output.mp4 split {video_5s} --start 00:00:01 --end 00:00:03"
    那麼 檔案 "output.mp4" 應該存在
    並且 結束狀態碼應該為 0
