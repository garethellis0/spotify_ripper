import unittest

from src.AbstractDownloader import Downloader
from src.YouTubeDownloader import YouTubeDownloader

class YouTubeDownloaderTest(unittest.TestCase):


    # Before running tests, DOWNLOADED_PLAYLISTS_FILE_PATH in AbstractDownloader should be pointed
    # to test/test_downloaded_songs.txt
    def test_downloader(self):
        test_request = [
            {
                "title": "Life Itself",
                "artist": "Glass Animals",
                "album": "Life Itself",
                "time": "04:40",
            },

            {
                "title": "Disarm",
                "artist": "The Smashing Pumpkins",
                "album": "Siamese Dream",
                "time": "4:58"
            },

            {
                "title": "American Money",
                "artist": "BØRNS",
                "album": "Test",
                "time": "4:20",
            },

            {
                "title": "Get Right",
                "artist": "Jimmy Eat World",
                "album": "Get Right",
                "time": "02:49",
            },

            {
                "title": "Bang Bang",
                "artist": "Green Day",
                "album": "Bang Bang",
                "time": "03:25",
            },

            {
                "title": "Hardwired",
                "artist": "Metallica",
                "album": "Hardwired",
                "time": "03:11",
            },

            {
                "title": "Wake Up Call",
                "artist": "Nothing but Thieves",
                "album": "Nothing But Thieves (Deluxe)",
                "time": "02:45",
            },

            {
                "title": "Rock Lobster",
                "artist": "The B-52's",
                "album": "The B-52's",
                "time": "6:49",
            },

            {
                "title": "Just Can't Get Enough",
                "artist": "Depeche Mode",
                "album": "Catching Up With Depeche Mode",
                "time": "3:25",
            },

            {
                "title": "Red Flag",
                "artist": "The Moth & The Flame",
                "album": "test",
                "time": "4:20",
            },

            {
                "title": "Women",
                "artist": "Def Leppard",
                "album": "Hysteria",
                "time": "6:11",
            },

            {
                "title": "Camilla",
                "artist": "Basshunter",
                "album": "Bass Generation",
                "time": "3:23",
            },

            {
                "title": "Goodbye Forever",
                "artist": "Volbeat",
                "album": "Seal The Deal & Let's Boogie",
                "time": "4:31",
            },

            {
                "title": "Coffee Girl",
                "artist": "The Tragically Hip",
                "album": "We Are The Same",
                "time": "3:46",
            },

            {
                "title": "You & I",
                "artist": "Colony House",
                "album": "Only The Lonely",
                "time": "3:27"
            },

            {
                "title": "Curse the Weather",
                "artist": "Royal Tusk",
                "album": "Curse the Weather",
                "time": "3:44"
            },

            {
                "title": "Blow",
                "artist": "Theory of a Deadman",
                "album": "Savages",
                "time": "3:36"
            },

            {
                "title": "Who Made Who",
                "artist": "AC/DC",
                "album": "Who Made Who",
                "time": "3:36"
            }
        ]

        ytdl = YouTubeDownloader(test_request, "test_playlist")
        ytdl.download_songs()


if __name__ == '__main__':
    unittest.main()