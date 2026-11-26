"""Regression tests for video-only output."""
from datetime import timedelta
from pathlib import Path

from ffxpy.__main__ import compile_commandline
from ffxpy.setting import Setting


def test_video_only_copy_ignores_audio_bitrate():
    setting = Setting(audio_codec='none', audio_bitrate='192k', dry_run=True)
    args = compile_commandline(setting, Path('input.mp4'), Path('output.mp4'))
    assert '-an' in args
    assert '-c:a' not in args
    assert '-b:a' not in args
    assert args.index('-an') > args.index('-i')


def test_video_only_accurate_cut_does_not_reenable_audio():
    setting = Setting(
        video_codec='libx264', video_bitrate='4M', audio_codec='none',
        start=timedelta(seconds=2), end=timedelta(seconds=4), dry_run=True,
    )
    args = compile_commandline(setting, Path('input.mp4'), Path('output.mp4'))
    assert '-an' in args
    assert '-af' not in args
    assert '-c:a' not in args


def test_default_still_copies_audio():
    setting = Setting(dry_run=True)
    args = compile_commandline(setting, Path('input.mp4'), Path('output.mp4'))
    assert args[args.index('-c:a') + 1] == 'copy'
    assert '-an' not in args
