import unittest
import os
from SpotifyScraperAPI import SpotifyScraperAPI
import youtube_dl

dl = youtube_dl.FileDownloader

class TestSpotifyScraperAPI(unittest.TestCase):

    def test_get_playlist(self):
        spotify_scraper_api = SpotifyScraperAPI()
        with open('test_html_src') as html_src_file:
            spotify_scraper_api.html_src = html_src_file.read()
        playlist = spotify_scraper_api.get_playlist()

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

        ]

        playlist = spotify_scraper_api.get_playlist()
        self.assertListEqual(expected_playlist, playlist)

if __name__ == '__main__':
    unittest.main()
