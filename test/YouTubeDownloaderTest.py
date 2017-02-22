import unittest
from src.YouTubeDownloader import YouTubeDownloader


class YouTubeDownloaderTest(unittest.TestCase):
    # Before running tests, DOWNLOADED_PLAYLISTS_FILE_PATH in AbstractDownloader should be pointed
    # to test/test_downloaded_songs.txt
    # and FAILED_DOWNLOADED_SONGS_FILE_PATH and DOWNLOADED_PLAYLISTS_FILE_PATH in Controller.py should
    # be changed to the test versions
    def test_downloader(self):
        test_request = [
            {
                "title": "Life Itself",
                "artist": "Glass Animals",
                "album": "Life Itself",
                "time": 280
            },

            {
                "title": "Disarm",
                "artist": "The Smashing Pumpkins",
                "album": "Siamese Dream",
                "time": 197
            },

            {
                "title": "American Money",
                "artist": "BØRNS",
                "album": "Test",
                "time": 260
            },

            {
                "title": "Get Right",
                "artist": "Jimmy Eat World",
                "album": "Get Right",
                "time": 169
            },

            {
                "title": "Bang Bang",
                "artist": "Green Day",
                "album": "Bang Bang",
                "time": 205
            },

            {
                "title": "Hardwired",
                "artist": "Metallica",
                "album": "Hardwired",
                "time": 191
            },

            {
                "title": "Wake Up Call",
                "artist": "Nothing but Thieves",
                "album": "Nothing But Thieves (Deluxe)",
                "time": 165
            },

            {
                "title": "Rock Lobster",
                "artist": "The B-52's",
                "album": "The B-52's",
                "time": 409
            },

            {
                "title": "Just Can't Get Enough",
                "artist": "Depeche Mode",
                "album": "Catching Up With Depeche Mode",
                "time": 205
            },

            {
                "title": "Red Flag",
                "artist": "The Moth & The Flame",
                "album": "test",
                "time": 260
            },

            {
                "title": "Women",
                "artist": "Def Leppard",
                "album": "Hysteria",
                "time": 371
            },

            {
                "title": "Camilla",
                "artist": "Basshunter",
                "album": "Bass Generation",
                "time": 203
            },

            {
                "title": "Goodbye Forever",
                "artist": "Volbeat",
                "album": "Seal The Deal & Let's Boogie",
                "time": 271
            },

            {
                "title": "Coffee Girl",
                "artist": "The Tragically Hip",
                "album": "We Are The Same",
                "time": 226
            },

            {
                "title": "You & I",
                "artist": "Colony House",
                "album": "Only The Lonely",
                "time": 207
            },

            {
                "title": "Curse the Weather",
                "artist": "Royal Tusk",
                "album": "Curse the Weather",
                "time": 224
            },

            {
                "title": "Blow",
                "artist": "Theory of a Deadman",
                "album": "Savages",
                "time": 216
            },

            {
                "title": "Who Made Who",
                "artist": "AC/DC",
                "album": "Who Made Who",
                "time": 206
            }
        ]

        print(len(test_request))
        ytdl = YouTubeDownloader(test_request, "test_youtube_playlist")
        ytdl.download_songs()


if __name__ == '__main__':
    unittest.main()