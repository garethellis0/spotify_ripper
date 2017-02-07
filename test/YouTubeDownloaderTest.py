import unittest

from src.AbstractDownloader import Downloader
from src.YouTubeDownloader import YouTubeDownloader

class YouTubeDownloaderTest(unittest.TestCase):
    def test_downloader(self):
        test_request = [
            {
                "title": "Bang Bang",
                "artist": "Green Day",
                "album": "Bang Bang",
                "time": "03:25",
            }
        ]
        ytdl = YouTubeDownloader(test_request, "test_playlist")
        ytdl.download_songs()


if __name__ == '__main__':
    unittest.main()