import unittest
import os
from SpotifyScraperAPI import SpotifyScraperAPI
import youtube_dl

dl = youtube_dl.FileDownloader

class TestSpotifyScraperAPI(unittest.TestCase):

    def test_find_playlist_file_valid(self):
        spotify_scraper_api = SpotifyScraperAPI("test/test_files")
        expected_file_with_playlist = os.path.dirname(__file__) + "/test_files/saved_resource(3).html"
        file_with_playlist = spotify_scraper_api.find_playlist_file()
        self.assertEqual(expected_file_with_playlist, file_with_playlist)

    def test_find_playlist_file_invalid(self):
        with self.assertRaises(OSError):
            SpotifyScraperAPI("non_existent_dir")

    def test_get_playlist(self):
        spotify_scraper_api = SpotifyScraperAPI("test/test_files")
        expected_playlist = [
            {
                "Title": "Life Itself",
                "Artist": "Glass Animals",
                "Album": "Life Itself",
                "Time": "04:40"
            },

            {
                "Title": "Get Right",
                "Artist": "Jimmy Eat World",
                "Album": "Get Right",
                "Time": "02:49"
            },

            {
                "Title": "Bang Bang",
                "Artist": "Green Day",
                "Album": "Bang Bang",
                "Time": "03:25"
            },

            {
                "Title": "Hardwired",
                "Artist": "Metallica",
                "Album": "Hardwired",
                "Time": "03:11"
            },

            {
                "Title": "Wake Up Call",
                "Artist": "Nothing but Thieves",
                "Album": "Nothing But Thieves (Deluxe)",
                "Time": "02:45"
            },
        ]
        playlist = spotify_scraper_api.get_playlist()
        self.assertListEqual(expected_playlist, playlist)

if __name__ == '__main__':
    unittest.main()
