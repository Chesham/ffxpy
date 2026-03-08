# language: zh-TW
功能: 工作流併行執行
  使用者想要同時執行多個影片處理任務以節省時間

  場景: 在 Flow 中併行執行多個切割任務
    假如 我建立檔案 "parallel_flow.yml"，內容如下
      """
      setting:
        concurrency: 2
      jobs:
        - name: "Parallel Split 1"
          command: "split"
          setting:
            input_path: "{video_5s}"
            end: "00:00:01"
            output_path: "p1.mp4"
        - name: "Parallel Split 2"
          command: "split"
          setting:
            input_path: "{video_5s}"
            start: "00:00:02"
            end: "00:00:03"
            output_path: "p2.mp4"
      """
    當 我執行指令 "ffx flow parallel_flow.yml"
    那麼 結束狀態碼應該為 0
    並且 檔案 "p1.mp4" 應該存在
    並且 檔案 "p2.mp4" 應該存在
