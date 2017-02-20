import unittest
import os
from src.SpotifyScraper import SpotifyScraper
import youtube_dl

dl = youtube_dl.FileDownloader

class SpotifyScraperTest(unittest.TestCase):

    def setUp(self):
        self.cookie = "4aeb49139e71f1c91b82734e78196b26ad536015wQqZgfGWpX4NEGEOghGpd630ova8bzedEDZ8dfWlGkEdonL%2BT4vFsXDEKtcozD5CBJyBd5qSYBjs%2FRhDS7I7b%2FD0l70FfapB%2B1H73NWdYn3ON8%2BJ5lgXk8Y89DT3Ha8MMwFQku1ZkcNflUJh0JHwMT2Ns3sN1qemSNH0vIfymQ2FTFVRpOmGGyUiKCSiRTJUKVcwLljHBu%2BcdMx5OwNY3iBVsoZXyfUuk%2BmpQAujMGvVRoYUYl7BN23KJFkJ%2FwA3Vpw6Tlz1czoIxdxKsANuiD5%2BGR8pttSB0DnOZe3iioSzFC4ZRzV3YKUoY2%2Bjir05"

    def test_get_playlist(self):
        spotify_scraper_api = SpotifyScraper()
        with open('test_html_src') as html_src_file:
            spotify_scraper_api.html_src = html_src_file.read()
        playlist = spotify_scraper_api.get_playlist()

        expected_playlist = [
            {
                "title": "Life Itself",
                "artist": "Glass Animals",
                "album": "Life Itself",
                "time": 280
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

        ]

        self.assertListEqual(expected_playlist, playlist)

    # def test_get_100_long_playlist(self):
    #     playlist_url = "https://play.spotify.com/user/spotify/playlist/2Qi8yAzfj1KavAhWz1gaem"
    #     spotify_scraper_api = SpotifyScraper(playlist_url, self.cookie)
    #     songs = spotify_scraper_api.get_playlist()
    #     self.assertEqual(100, len(songs), "Check that the actual playlist length has not changed")

    # This test will not pass until support for longer playlists has been added
    # (ie. when spotify stops using BLOODY FLASH)
    # def test_get_9985_long_playlist(self):
    #     playlist_url = "https://play.spotify.com/user/cokieekill/playlist/32twOqGf8gIswTgzG3IKxP"
    #     spotify_scraper_api = SpotifyScraperAPI(playlist_url, self.cookie)
    #     songs = spotify_scraper_api.get_playlist()
    #     self.assertEqual(9985, len(songs))

if __name__ == '__main__':
    unittest.main()
