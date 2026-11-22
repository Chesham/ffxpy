import asyncio
import tempfile
import unittest
from pathlib import Path

from ffxpy.probe import input_format_args, is_png_prefixed_mpegts


class PngPrefixedMpegtsTests(unittest.TestCase):
    def test_transport_stream_hidden_by_png_prefix(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'sample.ts'
            fake_png = b'\x89PNG\r\n\x1a\n' + b'PNG' * 12
            packets = b''.join(b'\x47' + bytes(187) for _ in range(4))
            path.write_bytes(fake_png + packets)
            self.assertTrue(is_png_prefixed_mpegts(path))
            self.assertEqual(input_format_args(path), ['-f', 'mpegts'])

    def test_normal_png_is_not_treated_as_video(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'image.ts'
            path.write_bytes(b'\x89PNG\r\n\x1a\n' + bytes(4000))
            self.assertFalse(is_png_prefixed_mpegts(path))

    def test_regular_ts_uses_autodetection(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'sample.ts'
            path.write_bytes(b''.join(b'\x47' + bytes(187) for _ in range(4)))
            self.assertEqual(input_format_args(path), [])


if __name__ == '__main__':
    unittest.main()
