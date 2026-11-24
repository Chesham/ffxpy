import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import HTTPException

from ffxpy.web.hls_preview import SEGMENT_SECONDS, cache_path, configure_cache, playlist_text, make_boundaries, hls_durations, durations_match


class HlsPreviewTests(unittest.TestCase):
    def test_manifest_has_segments_and_discontinuities(self):
        manifest = playlist_text(Path('/tmp/example.TS'), [0, 8.05, 16.1, 18.25])
        self.assertEqual(manifest.count('#EXTINF:'), 3)
        self.assertNotIn('#EXT-X-DISCONTINUITY', manifest)
        self.assertIn('#EXTINF:2.150000,', manifest)
        self.assertIn('index=2', manifest)
        self.assertIn('#EXT-X-ENDLIST', manifest)
        self.assertEqual(SEGMENT_SECONDS, 8)

    def test_window_transition_is_only_discontinuity(self):
        bounds = [float(i * 8) for i in range(12)]
        manifest = playlist_text(Path('/tmp/input.ts'), bounds)
        self.assertEqual(manifest.count('#EXT-X-DISCONTINUITY'), 2)

    def test_manifest_rejects_invalid_duration(self):
        with self.assertRaises(HTTPException):
            playlist_text(Path('file.ts'), [])

    def test_keyframe_aligned_boundaries(self):
        bounds = make_boundaries([0, 1.96, 3.93, 7.97, 9.91, 11.88, 19.75], 21.0)
        self.assertEqual(bounds, [0, 9.91, 19.75, 21.0])

    def test_ffmpeg_extra_segment_detected_before_publishing(self):
        expected = [11.811811, 8.008011, 8.008, 8.008011, 8.008]
        # Regression: HNDS-056 index 113 used to return HTTP 422 because
        # native HLS produced six segments for five advertised entries.
        unexpected = [7.807811, 8.008, 8.008011, 8.008011, 8.008011, 4.004]
        corrected = [11.811811, 8.008011, 8.008, 8.008011, 8.008]
        self.assertFalse(durations_match(unexpected, expected))
        self.assertTrue(durations_match(corrected, expected))

    def test_hls_durations_parses_actual_ffmpeg_playlist(self):
        with TemporaryDirectory() as directory:
            manifest = Path(directory) / 'window.m3u8'
            manifest.write_text(
                '#EXTM3U\n#EXTINF:8.01,\npart_000.ts\n'
                '#EXTINF:9.84,\npart_001.ts\n#EXT-X-ENDLIST\n'
            )
            self.assertEqual(hls_durations(manifest), [8.01, 9.84])
            self.assertFalse(durations_match([8.01, 9.84], [8.01, 8.0]))

    def test_cache_invalidation_by_size_and_mtime(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            configure_cache(root)
            source = root / 'sample.ts'
            source.write_bytes(b'\x47' * 188)
            first = cache_path(source, 3)
            source.write_bytes(b'\x47' * 376)
            second = cache_path(source, 3)
            self.assertNotEqual(first, second)


if __name__ == '__main__':
    unittest.main()
