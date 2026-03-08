# language: zh-TW
功能: 工作流驗證
  當 YAML 檔案中的任務包含錯誤設定時，工作流應能正確識別並報錯

  場景: Flow 中的 Job 結束時間超出影片長度
    假如 我建立檔案 "invalid_flow.yml"，內容如下
      """
      jobs:
        - name: "Bad Split"
          command: "split"
          setting:
            input_path: "{video_5s}"
            end: "00:00:10"
      """
    當 我執行指令 "ffx flow invalid_flow.yml"
    那麼 輸出應該包含 "out of range"
    並且 結束狀態碼應該為 1
