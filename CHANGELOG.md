# CHANGELOG

## 🚀 [0.6.1] - 2026-10-21

### 🎨 Web UI & Workflow Improvements
- 🗂️ **Independent Source Closing**: Allow individual media sources to be closed even when referenced by jobs, safely detaching only that source from the flow.
- ↩️ **Reversible Flow Clearing**: Added a one-click Clear Flow action that becomes Undo Clear so the job queue can be restored immediately.
- ⚡ **Local SSD Temporary Directory**: Added a `temp_dir` Flow Setting, available through `Alt+S`, for placing Split/Crop intermediates and merge lists on faster local storage while keeping final Merge output in its configured destination.

### 🔧 Core Enhancements
- 📁 **Automatic Temp Directory Creation**: Automatically creates configured temporary directories before processing.

---

## 🚀 [0.6.0] - 2026-09-25

### ✨ Core Features & Enhancements
- 💾 **Smart Temp Fallback**: Added automatic fallback to an OS temp cache directory (`/tmp/ffxpy/cache_<sha256>`) when source input directories are read-only (e.g. read-only mounts, shared network storage), maintaining deterministic caching for `keep_temp` and fast execution without permission errors.
- 📁 **Auto-Create Output Directory**: Automatically creates non-existent output directories and parent folders when executing flows or single jobs.
- 📂 **Preserve Output Subdirectories**: Preserved relative subdirectories in output paths during flow execution rather than flattening them.
- 🧭 **File Browser Navigation**: Added permanent `.. (Parent Directory)` option and `Alt+ArrowUp` shortcut to quickly traverse up directory structures in the file browser.
- 🧠 **Path Persistence**: The file browser dialog remembers the last accessed directory in `localStorage` and automatically walks up to the nearest existing parent directory if a path no longer exists.

---

## 🚀 [0.5.3] - 2026-09-01

### 🚀 Stability & Process Management
- 🛡️ **Graceful Process Cancellation**: Ensured killed `ffmpeg` processes are properly waited on and file handles released before attempting temporary file cleanup, with retry mechanisms for locked files.
- 🧹 **Early Merge Cleanup**: Added tracking for merge intermediate clips in flow execution Phase 0, ensuring proper cleanup even if a workflow is aborted or cancelled mid-run.
- ⚙️ **Per-Job Temp Retention**: Respected individual job `keep_temp` settings when handling merge inputs rather than using global overrides.

### 🎨 Web UI & UX Improvements
- 🛡️ **Media Pool Resilience**: Prevented accidental eviction of sources from the Media Pool on transient preview decode errors unless the source file is actually missing (404).
- 🔄 **Dynamic Setting Reseeding**: Recomputed default seeded settings from remaining active media sources when a source file is removed.
- 🕒 **Time Input Sizing**: Compacted In/Out Point time inputs to better fit content without layout overflow.
- 🔤 **Clean Typography**: Streamlined monospace font stack to standard generic keywords across the UI.

### 🔧 Bug Fixes
- 🏷️ **Output Filename Disambiguation**: Added start/end timestamp ranges (`HH-MM-SS.mmm`) to crop output filenames to prevent file overwrite collisions.
- ✂️ **Normalized Clip Names**: Reduced crop-sourced clip names to base filenames in merge lists to prevent path resolution conflicts.

---

## 🚀 [0.5.2] - 2026-08-18

### 🎨 Web UI & UX Improvements
- ⌨️ **Keyboard Shortcut Documentation**: Added comprehensive documentation for File Selector and navigation shortcuts in the keyboard help modal.
- 🎯 **Browser Input Autofocus**: Automatically focuses the path input field when opening the file browser dialog, and added `Ctrl/Cmd+Enter` confirmation shortcut.

### 🔧 Bug Fixes
- 🎞️ **Filter Guard in Copy Mode**: Guarded against applying the `fps` filter when `video_codec` is set to `copy`, avoiding invalid ffmpeg stream-copy configurations.
- 🔄 **Default Merge Codec**: Changed merge task default video codec from `copy` to `inherit` to properly handle mixed or transcoded inputs.

---

## 🚀 [0.5.1] - 2026-08-18

### 🔧 Bug Fixes
- 📍 **Merge Path Resolution**: Resolved merge list file and output paths relative to the clip folder instead of the process launch current working directory, preventing broken concat lists when running from arbitrary directories.

---

## 🚀 [0.5.0] - 2026-08-18

### ✨ Core Features
- 🗂️ **Media Pool & Multi-Source Editing**: Added in-page interactive file browser dialog and multi-source Media Pool to switch between and edit multiple video sources seamlessly in the Web UI.
- ⚡ **Chunked HTTP 206 Streaming**: Implemented partial-content chunked streaming response in the Web API server to eliminate long buffering freezes during timeline seeking.
- 🔄 **Backend Live Reload**: Added `--reload` option to `ffx ui` for developer backend auto-reload.
- ⌨️ **Quick Job Creation Shortcuts**: Added `Alt+1`, `Alt+2`, `Alt+3` keyboard shortcuts in the Web UI for quick job creation.

### 🚀 Performance & Audio/Video Sync
- ⏱️ **Timestamp Regeneration & VFR Fix**: Used `+genpts` and avoided MP4 edit lists (`-avoid_negative_ts make_zero`) during stream copy to eliminate variable frame rate (VFR) bugs and extreme max frame rate glitches.
- 🎯 **Accurate Keyframe Seeking**: Added a 50ms buffer (`epsilon`) to copy mode seek timestamps to prevent snapping backwards to the preceding keyframe.
- 🎵 **A/V Sync & Rate Normalization**: Kept clip audio in sync and normalized mixed source frame rates when merging video segments.

### 🪟 Windows Compatibility
- 🔒 **File Handle Release**: Switched to synchronous file I/O within the async streaming generator to immediately release Windows file locks when clients disconnect.

---

## 🚀 [0.4.1] - 2026-06-24

### ✨ Core Features
- 📜 **Error Feedback**: Relayed `ffmpeg` stderr logs directly to the Web UI to provide immediate insights when background jobs fail.

### 🔧 Bug Fixes
- 🔗 **API Resolution**: Switched the Web UI to use relative `API_BASE` endpoints in production, enabling seamless access via external IPs.
- 🔑 **UUID Generation**: Implemented a secure fallback for `crypto.randomUUID()` to prevent app crashes when accessing the Web UI over non-HTTPS connections.
- 🔄 **Two-Way Binding**: Completely decoupled the YAML editor from visual state rendering, eliminating destructive auto-formatting while typing.
- 📼 **Smart Video Loading**: Pasting YAML with an `input_path` now automatically probes and loads the video timeline without erasing the existing Job Queue.
- 🪟 **Cross-Platform Paths**: Fixed an issue on Windows where backslashes in `ffxpy_merge_list.txt` caused `ffmpeg`'s concat demuxer to fail with `Invalid argument`. Path serialization now strictly uses POSIX forward slashes.
- 🌍 **Locale Encoding**: Enforced `utf-8` encoding when writing merge lists to disk, preventing catastrophic `ffmpeg` crashes on Windows systems using legacy default encodings (e.g., `cp950`).

---

## 🚀 [0.4.0] - 2026-06-14

### ✨ Core Features
- 🖼️ **Visual Cropping**: Integrated an interactive cropping tool into the Web UI with precise coordinate mapping.
- 🎨 **Unified Workflow Studio**: Delivered a professional React-based Web UI for visual timeline editing, keyframe snapping, and job management.
- 🧠 **Smart Codec Switching**: Automatically upgrades `copy` to `libx264` when filters (crop/scale) are present, ensuring seamless execution.
- ✂️ **Feature Unification**: Synchronized capabilities across `split`, `crop`, and `merge` commands—all now support cropping, scaling, and time ranges.
- 🎞️ **Auto-Deinterlace**: Implemented intelligent deinterlacing using both metadata detection and frame analysis (yadif).

### 🚀 CLI & Engine Improvements
- 🛡️ **Robust Execution**: Updated all commands to correctly report `ffmpeg` failures with non-zero exit codes.
- ⚙️ **Modern Packaging**: Migrated build system to `hatchling` for better asset management and production-ready `.whl` distribution.
- 📂 **Cross-platform Build**: Added `scripts/build.sh` and `scripts.build.bat` for easy one-click packaging on any OS.

### 🔧 Bug Fixes
- 🪟 **Async Windows Fix**: Resolved `RuntimeError: There is no active click context` by implementing robust context re-pushing in the async engine.
- 📍 **Path Normalization**: Improved path handling by automatically normalizing backslashes and relative paths.
- 🕵️ **Probe Stability**: Enhanced `ffprobe` reliability when handling missing codec or duration metadata.

---

## 🚀 [0.3.2] - 2026-03-15

### 📝 Documentation
- 🛠️ **Changelog Localization**: Updated latest changes into English for global consistency.
- 📖 **Example Standardization**: Ensuring all workflow examples are consistently formatted in README.

---

## 🚀 [0.3.1] - 2026-03-15

### 📝 Documentation & Examples
- 📖 **Workflow Refactor**: Updated YAML examples in README to use standard multi-line format for better readability.
- ⚙️ **Settings Reference**: Expanded configuration documentation with a comprehensive parameter table and environment variable (`FFXPY_*`) support.

### ⚙️ CI/CD Enhancements
- 🏗️ **Release Pipeline**: Enabled build stage for Git Tags to ensure full Docker image availability during production release.
- 🔧 **Variable Fixes**: Resolved environment variable availability in `after_script` blocks and corrected the publication token for multi-environment support.

---

## 🚀 [0.3.0] - 2026-03-14

### ✨ Features
- 🧬 **Multi-version Support**: Introduced `tox` and `tox-uv` with support for Python 3.9 through 3.13 testing matrix.
- ⚡ **Smart Merge Optimization**: Implemented `Smart Merge` to automatically optimize single-file merge operations into fast file moves.
- 🛠️ **Merge Enhancements**: Added support for transcoding, bitrate adjustment, and video scaling during merge operations.

### ⚙️ CI/CD
- 🏗️ **TBD Flow Adoption**: Refactored GitLab CI to follow `Trunk-Based Development` workflow.
- 🧪 **Parallel Matrix Testing**: Implemented containerized parallel execution for multi-version Python testing in CI to ensure environment consistency.
- 🧹 **Automatic Cleanup**: Added Docker image cleanup logic to automatically release disk space after testing and building.
- 📦 **Staged Publication**: Enabled manual publication to TestPyPI from `main` branch and automated PyPI release via Git Tags.

### 🔧 Fixes & Refactors
- 📍 **Environment Compatibility**: Switched to system `ffmpeg` to resolve execution errors (Exit Code 8) in container environments.
- 📦 **Dependency Relaxation**: Relaxed version constraints for `pydantic-settings` and `coverage` to ensure Python 3.9 compatibility.
- 🔬 **Test Stability**: Disabled `coverage` in container tests by default to prevent SQLite database locks during parallel execution.

### 📝 Documentation
- 🏷️ **Metadata Optimization**: Updated `pyproject.toml` with detailed classifiers, keywords, and project URLs for better PyPI presence.
- 📖 **Content Refactor**: Redesigned `README.md` with action-oriented headers, real-time progress visualization, and usage scenario guides.

---

## 🚀 [0.2.0] - 2026-03-09

### 📦 Core Features
- 📊 **Visual Progress Bar**: Implemented smooth progress tracking based on total duration with real-time monitoring.
- ✂️ **Precise Cutting**: Implemented hybrid seeking and duration-based cutting for accurate results.
- ✅ **Pre-flight Validation**: Integrated strict validation for flow jobs to prevent side effects on error.

### 🚀 Performance & Quality
- 🛡️ **Concurrency Control**: Dynamically adjusted concurrency based on task type (Encoding restricted to 2 for stability).
- ⚡ **CI Acceleration**: Optimized Docker build flow by pre-extracting FFmpeg to speed up testing.
