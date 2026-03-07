# language: zh-TW
功能: 執行工作流 (Flow)
  使用者想要透過 YAML 檔案自動化多個影片處理任務

  場景: 基本工作流執行
    假如 我建立檔案 "myflow.yml"，內容如下
      """
      jobs:
        - name: "Split 1"
          command: "split"
          setting:
            input_path: "{video_5s}"
            end: "00:00:01"
            output_path: "part1.mp4"
        - name: "Split 2"
          command: "split"
          setting:
            input_path: "{video_5s}"
            start: "00:00:02"
            output_path: "part2.mp4"
      """
    當 我執行指令 "ffx flow myflow.yml"
    那麼 結束狀態碼應該為 0
    並且 檔案 "part1.mp4" 應該存在
    並且 檔案 "part2.mp4" 應該存在
