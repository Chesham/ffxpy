# language: zh-TW
功能: 智慧合併 (Smart Merge)
  當合併任務只有一個來源檔案且不須轉碼時，應該直接移動檔案以優化效能。

  場景: 單一檔案合併 (copy 模式) 應該使用移動而非啟動 ffmpeg
    假如 我建立目錄 "temp_work"
    當 我執行指令 "ffx -w temp_work -o single_split_.mp4 split {video_5s} --start 00:00:00 --end 00:00:01"
    當 我執行指令 "ffx -w temp_work merge --with-split"
    那麼 結束狀態碼應該為 0
    並且 檔案 "temp_work/single_merged.mp4" 應該存在
    並且 檔案 "temp_work/single_split_.mp4" 應該不存在

  場景: 單一檔案合併 (轉碼模式) 應該依然使用 ffmpeg
    假如 我建立目錄 "temp_work_transcode"
    當 我執行指令 "ffx -w temp_work_transcode -o transcode_split_.mp4 split {video_5s} --start 00:00:00 --end 00:00:01"
    當 我執行指令 "ffx -w temp_work_transcode merge --with-split --video-codec libx264 --video-bitrate 1M"
    那麼 結束狀態碼應該為 0
    並且 檔案 "temp_work_transcode/transcode_merged.mp4" 應該存在
    並且 檔案 "temp_work_transcode/transcode_split_.mp4" 應該存在

  場景: 工作流中的智慧合併 (copy 模式)
    假如 我建立目錄 "temp_flow"
    並且 我建立檔案 "temp_flow/myflow.yml"，內容如下
      """
      jobs:
        - name: "Split 1"
          command: "split"
          setting:
            input_path: "{video_5s}"
            end: "00:00:01"
            output_path: "part1_split_.mp4"
        - name: "Smart Merge"
          command: "merge"
          setting:
            video_codec: "copy"
            audio_codec: "copy"
            output_path: "final.mp4"
      """
    當 我執行指令 "ffx -w temp_flow -c 1 flow temp_flow/myflow.yml"
    那麼 結束狀態碼應該為 0
    並且 檔案 "temp_flow/final.mp4" 應該存在
    並且 檔案 "temp_flow/part1_split_.mp4" 應該不存在
