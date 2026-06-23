# CHANGELOG

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
