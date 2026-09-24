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

  場景: 防資料遺失及安全清理機制測試 (Web API 後端)
    假如 我建立檔案 "safe_flow.yml"，內容如下
      """
      setting:
        input_path: "{video_5s}"
        keep_temp: false
      jobs:
        - name: "Split 1"
          command: "split"
          setting:
            end: "00:00:01"
            output_path: "safe_part1.mp4"
        - name: "Split 2"
          command: "split"
          setting:
            start: "00:00:02"
            output_path: "safe_part2.mp4"
        - name: "Merge"
          command: "merge"
          setting:
            output_path: "safe_merged.mp4"
      """
    當 我透過 Web 背景常駐程式執行工作流檔案 "safe_flow.yml"
    那麼 結束狀態碼應該為 0
    並且 檔案 "{video_5s}" 應該存在
    並且 檔案 "safe_part1.mp4" 應該不存在
    並且 檔案 "safe_part2.mp4" 應該不存在
    並且 檔案 "safe_merged.mp4" 應該存在
    並且 檔案 "ffxpy_merge_list.txt" 應該不存在

  場景: 來源影片所在目錄為唯讀時自動退避至 OS 暫存快取目錄
    假如 我建立唯讀目錄 "ro_media" 並將 "{video_5s}" 複製為 "ro_video.mp4"
    並且 我建立檔案 "ro_flow.yml"，內容如下
      """
      setting:
        input_path: "ro_media/ro_video.mp4"
        keep_temp: true
      jobs:
        - name: "Split 1"
          command: "split"
          setting:
            end: "00:00:01"
            output_path: "ro_split1.mp4"
      """
    當 我執行指令 "ffx flow ro_flow.yml"
    那麼 結束狀態碼應該為 0
    並且 檔案 "ro_split1.mp4" 在 OS 暫存快取目錄中應該存在
