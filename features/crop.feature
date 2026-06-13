# language: zh-TW
功能: 裁剪影片
  使用者想要將影片檔案裁剪出特定的區域

  場景: 基本影片裁剪
    假如 我執行指令 "ffx -o cropped.mp4 crop {video_5s} --crop 64:64:0:0 --video-codec libx264 --video-bitrate 1M"
    那麼 檔案 "cropped.mp4" 應該存在
    並且 結束狀態碼應該為 0

  場景: Flow 中的影片裁剪
    假如 我建立檔案 "crop_flow.yml"，內容如下
      """
      jobs:
        - name: "Crop Job"
          command: "crop"
          setting:
            input_path: "{video_5s}"
            crop: "32:32:10:10"
            video_codec: "libx264"
            video_bitrate: "5M"
            output_path: "flow_cropped.mp4"
      """
    當 我執行指令 "ffx flow crop_flow.yml"
    那麼 檔案 "flow_cropped.mp4" 應該存在
    並且 結束狀態碼應該為 0
