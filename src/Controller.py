import os

from legacy.SpotifyScraperAPI import SpotifyScraperAPI, InvalidCookieException
from .MP3Downloader import MP3Downloader


class Controller:
    def download_playlists(self):
        # TODO: make handle multiple playlists at a time
        # TODO: put playlists in own folder in downloads
        url_correct = "n"
        while True:
            # Check if there is a cookie cached, otherwise get a cookie from the user and cache it
            if url_correct != "y":
                playlist_url = str(input("Please enter the url of the playlist you wish to download: "))
            try:
                cookie_val = str(open(".cookie").read())
            except FileNotFoundError:
                cookie_val = str(input("Please enter your cookie: "))
                cookie_cache = open(".cookie", 'w+')
                cookie_cache.write(cookie_val)

            # Prompt the user for what they want to do
            try:
                # download the playlist
                spotify_scraper_api = SpotifyScraperAPI(playlist_url, cookie_val)
                songs = spotify_scraper_api.get_playlist()
                print("Successfully retrieved playlist, downloading songs from youtube")
                mp3_downloader = MP3Downloader(songs)
                mp3_downloader.get_downloads()
                break
            except InvalidCookieException:
                # Ask the user to double check the url
                url_correct = str(input("Was that url correct? (Will ask for new cookie if yes) (y/n): "))
                if url_correct is "y":
                    os.remove(".cookie")

    def redownload_playlists(self):
        return

    def download_custom_songs(self):
        return

    def download_failed_songs(self):
        return


