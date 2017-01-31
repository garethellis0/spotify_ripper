import unittest
import os
from SpotifyScraperAPI import SpotifyScraperAPI
import youtube_dl

dl = youtube_dl.FileDownloader

class TestSpotifyScraperAPI(unittest.TestCase):

    def setUp(self):
        self.cookie = "4aeb49139e71f1c91b82734e78196b26ad536015wQqZgfGWpX4NEGEOghGpd630ova8bzedEDZ8dfWlGkEdonL%2BT4vFsXDEKtcozD5CBJyBd5qSYBjs%2FRhDS7I7b%2FD0l70FfapB%2B1H73NWdYn3ON8%2BJ5lgXk8Y89DT3Ha8MMwFQku1ZkcNflUJh0JHwMT2Ns3sN1qemSNH0vIfymQ2FTFVRpOmGGyUiKCSiRTJUKVcwLljHBu%2BcdMx5OwNY3iBVsoZXyfUuk%2BmpQAujMGvVRoYUYl7BN23KJFkJ%2FwA3Vpw6Tlz1czoIxdxKsANuiD5%2BGR8pttSB0DnOZe3iioSzFC4ZRzV3YKUoY2%2Bjir05"

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
            {
                "Title": "Wake Up Call",
                "Artist": "Nothing but Thieves",
                "Album": "Nothing But Thieves (Deluxe)",
                "Time": "02:45",
            },

        ]

        self.assertListEqual(expected_playlist, playlist)

    def test_get_100_long_playlist(self):
        playlist_url = "https://play.spotify.com/user/spotify/playlist/2Qi8yAzfj1KavAhWz1gaem"
        spotify_scraper_api = SpotifyScraperAPI(playlist_url, self.cookie)
        songs = spotify_scraper_api.get_playlist()
        self.assertEqual(100, len(songs), "Check that the actual playlist length has not changed")

    # This test will not pass until support for longer playlists has been added
    # (ie. when spotify stops using BLOODY FLASH)
    # def test_get_9985_long_playlist(self):
    #     playlist_url = "https://play.spotify.com/user/cokieekill/playlist/32twOqGf8gIswTgzG3IKxP"
    #     spotify_scraper_api = SpotifyScraperAPI(playlist_url, self.cookie)
    #     songs = spotify_scraper_api.get_playlist()
    #     self.assertEqual(9985, len(songs))

if __name__ == '__main__':
    unittest.main()
