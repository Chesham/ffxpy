# ffxpy

**ffxpy** is a powerful Python command-line tool designed to simplify and streamline complex `ffmpeg` workflows. It provides a structured way to manage video processing tasks like splitting, merging, and executing multi-step pipelines via YAML configuration files.

## Features

- **Split**: Easily split videos by time range or specific start/end points.
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

**Global Options:**

The `ffx` command supports several global options that apply to all subcommands:
- `--working-dir`, `-w`: Specifies the working directory for input/output files.
- `--output-path`, `-o`: Specifies the default output file path.
- `--overwrite`, `-y`: Overwrite output file if it exists.

### 1. Split

Split a video file based on time ranges.

```bash
# Split from 10s to 20s
uv run ffx split input.mp4 --start 00:00:10 --end 00:00:20
```

### 2. Merge

Merge video files.

`ffxpy` can automatically find suitable files in the specified working directory for merging.

```bash
# Merge files in a specified working directory and output to a specified path
uv run ffx --working-dir ./parts --output-path merged.mp4 merge --with-split

# Merge with automatic splitting of inputs if needed (requires specific naming/structure)
uv run ffx merge --with-split
```

### 3. Exec (Pass-through)

Directly execute raw `ffmpeg` commands. This "escape hatch" allows you to run any `ffmpeg` command that `ffxpy` doesn't explicitly wrap, while still benefitting from the project's context.

```bash
uv run ffx exec -i input.mp4 -vf scale=1280:-1 output.mp4
```

### 4. Flow (Pipeline Automation)

The **Flow** feature is the core value proposition of `ffxpy`. It allows you to script multiple `ffmpeg` operations into a single, automated YAML workflow. The `flow` feature automatically analyzes and adopts the optimal parallel execution strategy to execute actions for maximum performance.

**Basic Example: Split and Merge**

This is the most straightforward use case. The following `flow.yml` defines a global input file, splits it into two parts, and then automatically merges them back together. You only need to define the split points and the final output file.

```yaml
# simple_flow.yml
setting:
  input_path: "source.mp4" # Define the input for all jobs

jobs:
  # Job 1: Extract the first 10 seconds.
  # output_path will be auto-generated.
  - command: split
    setting:
      end: "00:00:10"

  # Job 2: Extract a clip from the 15-second mark.
  # output_path will also be auto-generated.
  - command: split
    setting:
      start: "00:00:15"

  # Job 3: Merge the previous two clips into a final output file.
  # 'merge' automatically finds the auto-generated outputs from the previous jobs.
  - command: merge
    setting:
      output_path: "merged_output.mp4"
```

**Running the Flow:**

```bash
uv run ffx flow simple_flow.yml
```

---

**Advanced Example: Configuration Inheritance**

For more complex scenarios, `ffxpy` supports **configuration inheritance**. You can define a top-level `setting` block, and its values will be inherited by all jobs in the flow. This is perfect for applying common parameters (like input files, codecs, or bitrate) to multiple operations, while allowing individual jobs to override them.

```yaml
# advanced_flow.yml

# Global Settings: These apply to all jobs below unless overridden.
setting:
  input_path: "./videos/source_movie.mp4"
  video_codec: "libx264"
  audio_codec: "aac"
  skip_existing: true

jobs:
  # Job 1: Extract the intro
  - command: split
    setting:
      end: "00:01:30"
      output_path: "./output/intro.mp4"

  # Job 2: Extract a specific scene (inherits input_path, codecs, etc.)
  - command: split
    setting:
      start: "00:15:00"
      end: "00:20:00"
      output_path: "./output/scene_1.mp4"

  # Job 3: Extract the ending
  - command: split
    setting:
      start: "01:45:00"
      output_path: "./output/credits.mp4"

  # Job 4: Merge them all back together
  # 'merge' automatically uses the outputs from jobs 1, 2, and 3 as its input.
  - command: merge
    setting:
      working_dir: "./output"
      output_path: "./output/highlights.mp4"
      overwrite: true
```

**Running the Advanced Flow:**

```bash
uv run ffx flow advanced_flow.yml
```

This matrix-style approach allows you to construct complex editing workflows in a clean, readable, and reproducible file.
