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

    # Ensure ffx points to coverage run or directly to the package
    if command.startswith('ffx '):
        # Use coverage to track the subprocess call
        # -a: append to data file
        # --source=ffxpy: track ffxpy package
        # -m ffxpy: run the package
        prefix = 'uv run coverage run -a --source=ffxpy -m ffxpy '
        full_command = command.replace('ffx ', prefix, 1)
    elif command == 'ffx':
        full_command = 'uv run coverage run -a --source=ffxpy -m ffxpy'
    else:
        full_command = command


    # Run the command and capture output
    env = os.environ.copy()
    if getattr(context, 'env', None):
        env.update(context.env)
    
    # Force coverage to write to the project root
    env['COVERAGE_FILE'] = os.path.join(os.getcwd(), '.coverage')

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
        print(f'File not found: {full_path}')
        print(f'Files in {context.working_dir}:')
        for f in context.working_dir.iterdir():
            print(f'  {f.name}')
    full_path.exists() | should.be.true


@then('檔案 "{file_path}" 應該不存在')
def step_then_file_should_not_exist(context, file_path):
    # Dynamic replacement for test files
    file_path = file_path.replace('{video_5s}', str(context.video_5s))
    full_path = context.working_dir / file_path
    full_path.exists() | should.be.false


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
