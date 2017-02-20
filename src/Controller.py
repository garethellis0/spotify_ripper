from src.SpotifyScraper import SpotifyScraper, InvalidCookieException
from src.YouTubeDownloader import YouTubeDownloader
from src.Util import Util
import os


class Controller:
    FAILED_DOWNLOADED_SONGS_FILE_PATH = os.path.dirname(
        os.path.realpath(__file__)) + "/../test/test_failed_song_downloads.txt"
    DOWNLOADED_PLAYLISTS_FILE_PATH = os.path.dirname(
        os.path.realpath(__file__)) + "/../test/test_downloaded_playlists.txt"

    @staticmethod
    def download_playlists(playlists=None):
        requested_playlists = []

        if playlists is None:
            while True:
                playlist_url = str(input("Enter the url of the playlist you want to download (enter a blank line when done): "))
                if playlist_url is "":
                    break
                else:
                    requested_playlists.append(playlist_url)

        for playlist in requested_playlists:
            Controller._download_single_playlist(playlist)

    @staticmethod
    def redownload_playlists(self):
        return

    @staticmethod
    def download_custom_songs(self):
        return

    @staticmethod
    def download_failed_songs(self):
        return

    @staticmethod
    def _download_single_playlist(playlist_url):
        while True:
            cookie = SpotifyScraper.get_cookie()
            try:
                # download the playlist
                spotify_scraper = SpotifyScraper(playlist_url, cookie)
                songs_and_name = spotify_scraper.get_playlist()
                playlist_name = songs_and_name[0]
                songs = songs_and_name[1]

                print("Successfully retrieved playlist \"{}\", downloading songs...".format(playlist_name))
                yt_dl = YouTubeDownloader(songs, playlist_name)
                results = yt_dl.download_songs()  # TODO: later add more downloaders here
                num_existing_songs = results[0]
                failed_downloads = results[1]
                num_failed_downloads = len(failed_downloads)

                summary_info = [len(songs), num_existing_songs, num_failed_downloads, len(songs) - num_existing_songs - num_failed_downloads]
                Util.print_summary(summary_info, playlist_name)

                # add the playlist url to the downloaded_playlists file if it doesn't already exist
                if playlist_url not in open(Controller.DOWNLOADED_PLAYLISTS_FILE_PATH).read():
                    with open(Controller.DOWNLOADED_PLAYLISTS_FILE_PATH, "a") as file:
                        file.write(playlist_url + "\n")

                # Check if any downloaded songs were in the list of failed downloads and remove them
                # also add the failed songs to the list
                with open(Controller.FAILED_DOWNLOADED_SONGS_FILE_PATH, "r") as file:
                    lines = file.readlines()

                downloaded_songs = [x for x in songs if x not in failed_downloads]
                lines_to_remove = []
                for song in downloaded_songs:
                    text = Util.get_song_filename_and_folder(song, playlist_name)
                    for line in lines:
                        if line is text:
                            lines_to_remove.append(line)

                for line in lines_to_remove:
                    lines.remove(line)

                with open(Controller.FAILED_DOWNLOADED_SONGS_FILE_PATH, "w") as file:
                    for line in lines:
                        file.write(line) # existing lines already have newline character
                    for song in failed_downloads:
                        if Util.get_song_filename_and_folder(song, playlist_name) + "\n" not in lines:
                            file.write(Util.get_song_filename_and_folder(song, playlist_name) + "\n")

                break
            except InvalidCookieException:
                while True:
                    # Ask the user to double check the url
                    print("Exception thrown with url: {}".format(playlist_url))
                    url_correct = str(input("Was that url correct? (Will ask for new cookie if yes) (y/n): "))
                    if url_correct is "y":
                        os.remove(".cookie")
                        break
                    elif url_correct is "n":
                        playlist_url = str(input("Please enter the correct url: "))
                        break
                    else:
                        print("Invalid input!")