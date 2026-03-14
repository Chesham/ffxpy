# CHANGELOG

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
