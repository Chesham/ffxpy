# ffxpy

![license](https://img.shields.io/badge/license-MIT-green)
![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)
[![PyPI Downloads](https://static.pepy.tech/personalized-badge/ffxpy?period=total&units=INTERNATIONAL_SYSTEM&left_color=BLACK&right_color=GREEN&left_text=downloads)](https://pepy.tech/projects/ffxpy)
[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Fuel%20the%20Turbo%20Mode&emoji=🚀&slug=chesham&button_colour=FFDD00&font_colour=000000&font_family=Bree&outline_colour=000000&coffee_colour=ffffff)](https://www.buymeacoffee.com/chesham)

**ffxpy** is a highly optimized CLI tool to automate complex `ffmpeg` tasks. It orchestrates splitting, merging, and transcoding through simple YAML workflows with intelligent resource management.

## 🚀 Why ffxpy?

- **Zero-Config Turbo Mode**: Automatically balances concurrency—up to **16** parallel jobs for I/O-bound tasks (`copy`), and restricted to **2** for CPU-intensive encoding to keep your system responsive.
- **Smart Merge Optimization**: Detects single-file merge tasks and uses direct file moves to bypass `ffmpeg` overhead completely.
- **Production-Ready Visualization**: Beautiful, real-time progress bars with live transcoding metrics (speed, FPS) powered by `rich`.
- **Pre-flight Validation**: Uses `ffprobe` to verify video assets and time ranges *before* starting long-running jobs.

## 📦 Installation

For the best experience, we recommend using [uv](https://github.com/astral-sh/uv):

```bash
# Install as a global tool
uv tool install ffxpy

# Or run it instantly without installation
uvx ffxpy flow highlights.yml
```

## 🛠 Usage & Scenarios

### 1. Automated Workflows (Recommended 🌟)

The most powerful way to use `ffxpy` is via YAML-defined workflows. It features a beautiful, real-time multi-tasking interface:

```yaml
# highlights.yml
setting:
  input_path: "stream_archive.mp4"

jobs:
  - name: "Intro Clip"
    command: split
    setting: { end: "00:00:15", output_path: "part1.mp4" }
  
  - name: "Best Action"
    command: split
    setting: { start: "01:20:00", end: "01:21:00", output_path: "part2.mp4" }

  - name: "Concatenate Highlights"
    command: merge
    setting: { output_path: "highlights_v1.mp4" }
```

**Real-time Progress:**

```text
Turbo Mode: All jobs are "copy", boosting to maximum I/O performance (8)
Starting flow with concurrency=8
Validating workflow...
Overall Progress ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%        0:00:07 0:00:00
Job #0           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% (188x) 0:00:02 0:00:00
Job #1           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% (85x)  0:00:00 0:00:00
Job #2           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% (165x) 0:00:01 0:00:00
Job #3           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% (114x) 0:00:00 0:00:00
Job #4           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% (101x) 0:00:00 0:00:00
Job #5           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% (163x) 0:00:00 0:00:00
Job #6           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% (201x) 0:00:04 0:00:00
```

### 2. Simple Command Line Operations

```bash
# Precision splitting (supports ISO durations or HH:MM:SS)
ffx split input.mp4 --start 00:00:10 --end 00:00:20 -o clip.mp4

# Smart merging of split parts
ffx merge --with-split -o final_merged.mp4
```

### 3. Advanced Transcoding during Merge

`ffxpy` isn't just for copying; you can transcode while merging:
```bash
ffx merge --with-split --video-codec libx264 --video-bitrate 5M --scale 1280:720
```

## ⚙️ Options Reference

- `--working-dir`, `-w`: Base directory for all relative paths.
- `--output-path`, `-o`: Explicit output path for the final result.
- `--overwrite`, `-y`: Force overwrite existing files.
- `--dry-run`, `-n`: Preview all generated ffmpeg commands without execution.
- `--concurrency`, `-c`: Manual override for smart concurrency logic.
