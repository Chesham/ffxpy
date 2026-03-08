# ffxpy

**ffxpy** is a powerful Python command-line tool designed to simplify and streamline complex `ffmpeg` workflows. It provides a structured way to manage video processing tasks like splitting, merging, and executing multi-step pipelines via YAML configuration files.

## Features

- **Split**: Easily split videos by time range or specific start/end points.
- **Merge**: Concatenate multiple video files automatically or manually.
- **Flow**: Define complex processing pipelines using YAML files. Supports parallel execution and configuration inheritance.
- **Exec**: A pass-through mode to execute raw `ffmpeg` commands while leveraging the project's environment management.
- **Rich Visualization**: Beautiful progress bars for tracking transcoding status in real-time.
- **Smart Validation**: Pre-flight checks for `ffmpeg` availability and video duration/range validation using `ffprobe`.
- **Dry-run Mode**: Preview generated commands without actually executing heavy transcoding tasks.

## Installation

This project is managed using `uv`. Ensure you have it installed.

```bash
uv sync
```

## Usage

The main entry point is the `ffx` command. You can run it via `uv run` to ensure all dependencies are correctly loaded.

**Global Options:**

The `ffx` command supports several global options that apply to all subcommands:
- `--working-dir`, `-w`: Specifies the working directory for input/output files.
- `--output-path`, `-o`: Specifies the default output file path.
- `--overwrite`, `-y`: Overwrite output file if it exists.
- `--dry-run`, `-n`: Do not execute ffmpeg commands, only print them.
- `--concurrency`, `-c`: Number of concurrent jobs to run in a flow (default: 1).
- `--version`, `-v`: Show the version and exit.

### 1. Split

Split a video file based on time ranges. Support `HH:MM:SS` or `ISO 8601` duration formats.

```bash
# Split from 10s to 20s
uv run ffx split input.mp4 --start 00:00:10 --end 00:00:20
```

### 2. Merge

Merge video files. `ffxpy` can automatically find suitable files in the specified working directory for merging.

```bash
# Merge files in a specified working directory and output to a specified path
uv run ffx --working-dir ./parts --output-path merged.mp4 merge --with-split

# Merge with automatic discovery of previously split parts
uv run ffx merge --with-split
```

### 3. Exec (Pass-through)

Directly execute raw `ffmpeg` commands. This "escape hatch" allows you to run any `ffmpeg` command while still benefitting from `ffxpy`'s context management.

```bash
uv run ffx exec -i input.mp4 -vf scale=1280:-1 output.mp4
```

### 4. Flow (Pipeline Automation)

The **Flow** feature allows you to script multiple `ffmpeg` operations into a single, automated YAML workflow.

**Parallel Execution:**
You can use the `concurrency` setting to run multiple independent jobs simultaneously.

```yaml
# parallel_flow.yml
setting:
  input_path: "source.mp4"
  concurrency: 4 # Run up to 4 ffmpeg jobs at once

jobs:
  - name: "Part A"
    command: split
    setting: { end: "00:01:00", output_path: "a.mp4" }
  
  - name: "Part B"
    command: split
    setting: { start: "00:02:00", end: "00:03:00", output_path: "b.mp4" }

  - name: "Combine"
    command: merge
    setting: { output_path: "final.mp4" }
```

**Running the Flow:**

```bash
uv run ffx flow parallel_flow.yml
```

---

**Configuration Inheritance:**

Define common parameters (like codecs, bitrates, or paths) in a top-level `setting` block to apply them to all jobs.

```yaml
# advanced_flow.yml
setting:
  input_path: "./videos/source.mp4"
  video_codec: "libx264"
  audio_codec: "aac"
  skip_existing: true

jobs:
  - command: split
    setting:
      end: "00:01:30"
      output_path: "./output/intro.mp4"

  - command: split
    setting:
      start: "00:15:00"
      end: "00:20:00"
      output_path: "./output/scene_1.mp4"

  - command: merge
    setting:
      working_dir: "./output"
      output_path: "./output/highlights.mp4"
      overwrite: true
```

## Development and Testing

The project uses BDD (Behavior-Driven Development) for testing.

```bash
# Run all tests
uv run behave

# Run linting
uv run ruff check .
```
