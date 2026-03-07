# language: zh-TW
功能: 合併影片
  使用者想要將多個影片片段合併成一個檔案

  場景: 基本影片合併
    假如 我執行指令 "ffx -o test_split_1.mp4 split {video_5s} --start 00:00:00 --end 00:00:01"
    並且 我執行指令 "ffx -o test_split_2.mp4 split {video_5s} --start 00:00:02 --end 00:00:03"
    當 我執行指令 "ffx merge --with-split"
    那麼 結束狀態碼應該為 0
    並且 檔案 "test_merged.mp4" 應該存在
