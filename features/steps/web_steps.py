import asyncio
from pathlib import Path
from behave import when, then
from grappa import should
from fastapi import Request
from ffxpy.web.main import stream_video, probe_video

@when('我對 API "/api/probe" 發送探測請求，參數為 "{file_name}"')
def step_probe_video(context, file_name):
    file_path = context.video_5s if file_name == "{video_5s}" else Path(file_name)
    
    # Run the probe async function
    context.probe_response = asyncio.run(probe_video(str(file_path), ffprobe_path="ffprobe"))

@then('探測結果應該包含 "{key}"')
def step_check_probe_key(context, key):
    # Convert Pydantic model to dict
    data = context.probe_response.model_dump()
    data | should.have.key(key)

@then('"{key}" 應該為正整數')
def step_check_positive_integer(context, key):
    data = context.probe_response.model_dump()
    val = data.get(key)
    val | should.be.a(int)
    val | should.be.higher.than(0)

@when('我對 API "/api/stream" 發送串流請求，參數為 "{file_name}"，並設定 Range 為 "{range_val}"')
def step_stream_video(context, file_name, range_val):
    file_path = context.video_5s if file_name == "{video_5s}" else Path(file_name)
    
    # Mock FastAPI Request
    scope = {
        "type": "http",
        "headers": [(b"range", range_val.encode('utf-8'))],
    }
    request = Request(scope)
    
    # Call the async stream_video endpoint directly
    context.stream_response = asyncio.run(stream_video(str(file_path), request))

@then('回傳的 HTTP 狀態碼應該為 {code:d}')
def step_check_stream_status(context, code):
    context.stream_response.status_code | should.be.equal.to(code)

@then('回傳的 Header 中 "{header}" 應該不大於 "{max_val}"')
def step_check_header_max(context, header, max_val):
    headers = context.stream_response.headers
    val = int(headers.get(header.lower(), 0))
    val | should.be.lower.than(int(max_val) + 1)
