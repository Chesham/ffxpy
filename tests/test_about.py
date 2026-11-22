import asyncio
import unittest

from ffxpy import __version__
from ffxpy.web.main import get_about


class AboutAPITests(unittest.TestCase):
    def test_about_reports_version_and_release_notes(self):
        info = asyncio.run(get_about())
        self.assertEqual(info['version'], __version__)
        self.assertIn(f'[{__version__}]', info['changelog'])
        self.assertIn('50ms', info['changelog'])


if __name__ == '__main__':
    unittest.main()
