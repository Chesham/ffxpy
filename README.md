# ffxpy

**ffxpy** is a powerful Python command-line tool designed to simplify and streamline complex `ffmpeg` workflows. It provides a structured way to manage video processing tasks like splitting, merging, and executing multi-step pipelines via YAML configuration files.

## Features

- **Split**: Easily split videos by time range, frame count, or specific start/end points.
- **Merge**: Concatenate multiple video files automatically or manually.
- **Flow**: Define complex processing pipelines using YAML files. This allows for reproducible and batch-processable workflows.
- **Exec**: A pass-through mode to execute raw `ffmpeg` commands while leveraging the project's environment management.

## Installation

This project is managed using `uv`. Ensure you have it installed.

```bash
uv sync
```

## Usage

The main entry point is the `ffx` command. You can run it via `uv run` to ensure all dependencies are correctly loaded.

### 1. Split

Split a video file based on time ranges.

```bash
# Split from 10s to 20s
uv run ffx split input.mp4 --start 00:00:10 --end 00:00:20

# Split using frame counts
uv run ffx split input.mp4 --start-frame 100 --end-frame 500
```

### 2. Merge

Merge video files.

```bash
# Merge files in a directory
uv run ffx merge --working-dir ./parts --output-path merged.mp4

# Merge with automatic splitting of inputs if needed (requires specific naming/structure)
uv run ffx merge --with-split
```

### 3. Exec (Pass-through)

Directly execute raw `ffmpeg` commands. This "escape hatch" allows you to run any `ffmpeg` command that `ffxpy` doesn't explicitly wrap, while still benefitting from the project's context.

```bash
uv run ffx exec -i input.mp4 -vf scale=1280:-1 output.mp4
```

### 4. Flow (Pipeline Automation)

The **Flow** feature is the core value proposition of `ffxpy`. It allows you to script multiple `ffmpeg` operations into a single YAML workflow.

**Matrix-style Configuration & Inheritance**
`ffxpy` Flows support configuration inheritance. You can define a top-level `setting` block. All jobs in the flow will inherit these settings. This is perfect for applying common parameters (like input files, codecs, or bitrate) to multiple operations, while allowing individual jobs to override them or add specific details (like start/end times).

**Example `flow.yml`:**

```yaml
# Global Settings: These apply to all jobs below unless overridden.
# This eliminates the need to repeat the input path or codec for every split.
setting:
  input_path: "./videos/source_movie.mp4"
  video_codec: "libx264"
  audio_codec: "aac"
  skip_existing: true

jobs:
  # Job 1: Extract the intro
  - command: split
    setting:
      end: 00:01:30
      output_path: "./output/intro.mp4"

  # Job 2: Extract a specific scene
  # Inherits input_path, video_codec, etc.
  - command: split
    setting:
      start: 00:15:00
      end: 00:20:00
      output_path: "./output/scene_1.mp4"

  # Job 3: Extract the ending
  - command: split
    setting:
      start: 01:45:00
      output_path: "./output/credits.mp4"

  # Job 4: Merge them all back together
  # This job overrides the global 'input_path' context implicitly by its nature (merge uses multiple inputs),
  # but can still inherit other compatible settings.
  - command: merge
    setting:
      working_dir: "./output"
      output_path: "./output/highlights.mp4"
      overwrite: true
```

**Running the Flow:**

```bash
uv run ffx flow ./my_flow.yml
```

This approach allows you to construct complex editing matrices—like splitting multiple segments from a single source and then immediately merging them—in a clean, readable, and reproducible file.
