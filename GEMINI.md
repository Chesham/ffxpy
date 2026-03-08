# GEMINI Project Context: ffxpy

> [!IMPORTANT]
> **Mandate:** Always activate and adhere to the `product-manager` skill when performing tasks related to feature definition, roadmap planning, or requirement analysis for this project.

## Project Overview

`ffxpy` is a Python command-line tool designed to simplify complex `ffmpeg` operations. It provides a user-friendly interface and a workflow system to chain multiple `ffmpeg` commands together. The project is built using `typer` for the CLI and `pydantic` for data validation and settings management.

The core functionalities include:
- **Splitting:** Splitting video files based on time ranges.
- **Merging:** Merging multiple video files into one.
- **Flows:** Executing a predefined sequence of operations from a YAML file.

## Building and Running

This is a Python project managed with `uv`.

### Installation

To install dependencies, run:
```bash
uv sync
```

### Running the tool

The main entry point is the `ffx` command. You can run it via `uv` or directly if the package is installed.

**Global Options:**

The `ffx` command supports several global options that apply to all subcommands:
- `--working-dir`, `-w`: Working directory.
- `--output-path`, `-o`: Output video file path.
- `--overwrite`, `-y`: Overwrite output file if it exists.
- `--dry-run`, `-n`: Print ffmpeg commands without executing them.
- `--concurrency`, `-c`: Manually override the dynamic concurrency logic.

**General Usage:**
```bash
uv run ffx [OPTIONS] COMMAND [ARGS]...
```

**Commands:**

*   **`split`**: Splits a video file.
    ```bash
    uv run ffx split <INPUT_FILE> --start <HH:MM:SS> --end <HH:MM:SS> -o <OUTPUT_FILE>
    ```

*   **`merge`**: Merges video files.
    ```bash
    uv run ffx merge --with-split
    ```

*   **`flow`**: Executes a workflow defined in a YAML file.
    ```bash
    uv run ffx flow <PATH_TO_FLOW.YML>
    ```

### Example Flow YAML (`ffxflow.yml`)

```yaml
# ffxflow.yml
jobs:
  - name: "Split first part"
    command: "split"
    setting:
      input_path: "my_video.mp4"
      end: "00:01:30"
      video_codec: "libx264"
      video_bitrate: "5M"

  - name: "Split second part"
    command: "split"
    setting:
      input_path: "my_video.mp4"
      start: "00:02:00"
      video_codec: "libx264"
      video_bitrate: "5M"
```

## Development Conventions

*   **CLI:** The project uses `async_typer` to build the command-line interface. New commands and options should be added in `src/ffxpy/__main__.py`.
*   **Settings:** Application settings are managed with `pydantic-settings` in `src/ffxpy/setting.py`. Settings can be provided via a `.env` file (with `FFXPY_` prefix) or as command-line arguments.
*   **Data Models:** Data structures for flows and jobs are defined using `pydantic` in `src/ffxpy/models/flow.py`.
*   **Concurrency:** The system employs "Smart Concurrency" which dynamically adjusts based on CPU cores and job types (e.g., boosting for 'copy' tasks up to 16, limiting for 'encoding' tasks to 2 to avoid resource contention).
*   **Dependencies:** Project dependencies are listed in `pyproject.toml`.
*   **Testing:** The project uses `behave` and `grappa` for Behavior-Driven Development (BDD). Feature files are located in the `features/` directory.
*   **Progress Tracking:** Real-time progress is displayed using `rich`. The `flow` command features a smooth overall progress bar based on total job durations.
*   **Quality Enforcement:** ALWAYS run `uv run ruff check .` and `uv run mypy .` after any code modification to ensure linting and type safety.

## Agent Communication Protocol

For clarity and consistency, the following protocol should be observed when interacting with the agent:
- **File Modifications:** All changes made to project files (e.g., code, documentation, configuration) must be in English.
- **Agent Responses:** All responses from the agent to the user should be in Traditional Chinese.