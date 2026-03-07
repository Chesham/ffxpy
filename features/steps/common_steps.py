import os
import subprocess

from behave import given, then, when
from grappa import should


@given('我設定環境變數 "{name}" 為 "{value}"')
def step_given_set_env(context, name, value):
    if not hasattr(context, 'env'):
        context.env = os.environ.copy()
    context.env[name] = value


@given('我執行指令 "{command}"')
@when('我執行指令 "{command}"')
@then('我執行指令 "{command}"')
def step_when_run_command(context, command):
    # Dynamic replacement for test files
    command = command.replace('{video_5s}', str(context.video_5s))

    # Ensure ffx points to 'uv run ffx' or directly to the package
    if command.startswith('ffx'):
        full_command = f'uv run {command}'
    else:
        full_command = command

    # Run the command and capture output
    env = getattr(context, 'env', None)
    result = subprocess.run(
        full_command,
        shell=True,
        capture_output=True,
        text=True,
        cwd=context.working_dir,
        env=env,
    )

    context.last_command = command
    context.last_result = result
    context.stdout = result.stdout
    context.stderr = result.stderr
    context.return_code = result.returncode

    if context.return_code != 0:
        print(f'Command failed: {full_command}')
        print(f'STDOUT: {context.stdout}')
        print(f'STDERR: {context.stderr}')



@then('檔案 "{file_path}" 應該存在')
def step_then_file_should_exist(context, file_path):
    # Dynamic replacement for test files
    file_path = file_path.replace('{video_5s}', str(context.video_5s))
    full_path = context.working_dir / file_path
    if not full_path.exists():
        print(f"File not found: {full_path}")
        print(f"Files in {context.working_dir}:")
        for f in context.working_dir.iterdir():
            print(f"  {f.name}")
    full_path.exists() | should.be.true


@given('我建立檔案 "{file_name}"，內容如下')
def step_given_create_file(context, file_name):
    content = context.text.replace('{video_5s}', str(context.video_5s))
    file_path = context.working_dir / file_name
    with open(file_path, 'w') as f:
        f.write(content)


@then('輸出應該包含 "{expected_text}"')
def step_then_output_should_contain(context, expected_text):
    combined_output = context.stdout + context.stderr
    combined_output | should.contain(expected_text)


@then('結束狀態碼應該為 {expected_code:d}')
def step_then_return_code_should_be(context, expected_code):
    context.return_code | should.be.equal.to(expected_code)
