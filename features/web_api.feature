# language: zh-TW
功能: Web API 端點測試
  使用者想要透過 Web API 取得影片資訊並進行串流播放

  場景: 探測影片時應該正確回傳 bit_rate
    當 我對 API "/api/probe" 發送探測請求，參數為 "{video_5s}"
    那麼 探測結果應該包含 "bit_rate"
    並且 "bit_rate" 應該為正整數

  場景: 請求影片串流時應該支援自動分塊 (Chunked) 限制
    當 我對 API "/api/stream" 發送串流請求，參數為 "{video_5s}"，並設定 Range 為 "bytes=0-"
    那麼 回傳的 HTTP 狀態碼應該為 206
    並且 回傳的 Header 中 "Content-Length" 應該不大於 "2097152"

  場景: 瀏覽檔案目錄時若路徑不存在應自動退回上一層存在的目錄
    當 我對 API "/api/browse" 發送目錄瀏覽請求，路徑為 "{video_5s}/ghost_folder"
    那麼 回傳的瀏覽路徑應該等於 "{video_5s}" 的所在目錄
