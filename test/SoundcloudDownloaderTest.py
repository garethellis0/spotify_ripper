import unittest
from src.SoundcloudDownloader import SoundcloudDownloader

class YouTubeDownloaderTest(unittest.TestCase):
    # Before running tests, DOWNLOADED_PLAYLISTS_FILE_PATH in AbstractDownloader should be pointed
    # to test/test_downloaded_songs.txt
    # and FAILED_DOWNLOADED_SONGS_FILE_PATH and DOWNLOADED_PLAYLISTS_FILE_PATH in Controller.py should
    # be changed to the test versions
    def test_downloader(self):
        test_request = [
            {
                "title": "Hellfire",
                "artist": "Barns Courtney",
                "album": "The Dull Drums - EP",
                "time": 169
            },

            {
                "title": "Curse The Weather",
                "artist": "Royal Tusk",
                "album": "DealBreaker",
                "time": 224
            },
        ]

        print(len(test_request))
        scdl = SoundcloudDownloader(test_request, "test_soundcloud_playlist")
        print(scdl._construct_search_url(test_request[0]))
        print(scdl._construct_search_url(test_request[1]))

        scdl._get_search_info("https://soundcloud.com/search/sounds?q=royal%20tusk%20curse%20the%20weather")
        #scdl.download_songs()


if __name__ == '__main__':
    unittest.main()