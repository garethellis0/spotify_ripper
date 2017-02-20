from src.SpotifyScraper import SpotifyScraper, InvalidCookieException
from src.YouTubeDownloader import YouTubeDownloader
from src.Util import Util
import os
import json


class Controller:
    FAILED_DOWNLOADED_SONGS_FILE_PATH = os.path.dirname(
        os.path.realpath(__file__)) + "/../test/test_failed_song_downloads.json"
    DOWNLOADED_PLAYLISTS_FILE_PATH = os.path.dirname(
        os.path.realpath(__file__)) + "/../test/test_downloaded_playlists.json"


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
        else:
            requested_playlists = playlists

        for playlist in requested_playlists:
            Controller._download_single_playlist(playlist)


    @staticmethod
    def redownload_playlists():
        Util.check_file(Controller.DOWNLOADED_PLAYLISTS_FILE_PATH)
        with open(Controller.DOWNLOADED_PLAYLISTS_FILE_PATH, "r") as file:
            try:
                playlists = json.load(file)
            except Exception:
                playlists = []

        if len(playlists) is 0:
            print("No playlists on file to download")
        else:
            Controller.download_playlists(playlists)


    @staticmethod
    def download_custom_songs():
        return

    @staticmethod
    def download_failed_songs():
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

                # add the playlist to the list of downloaded playlists
                Util.check_file(Controller.DOWNLOADED_PLAYLISTS_FILE_PATH)
                with open(Controller.DOWNLOADED_PLAYLISTS_FILE_PATH, "r") as file:
                    try:
                        downloaded_playlists = json.load(file)
                    except Exception:
                        downloaded_playlists = []

                if playlist_url not in downloaded_playlists:
                    downloaded_playlists.append(playlist_url)

                with open(Controller.DOWNLOADED_PLAYLISTS_FILE_PATH, "w") as file:
                    json.dump(downloaded_playlists, file, indent=4)

                # Check if any downloaded songs were in the list of failed downloads and remove them
                # also add the failed songs to the list
                Util.check_file(Controller.FAILED_DOWNLOADED_SONGS_FILE_PATH)
                with open(Controller.FAILED_DOWNLOADED_SONGS_FILE_PATH, "r") as file:
                    try:
                        playlist_dict = json.load(file)
                    except Exception:
                        playlist_dict = {}

                downloaded_songs = [x for x in songs if x not in failed_downloads]
                songs_to_remove = []

                if playlist_name in playlist_dict.keys():
                    for song in downloaded_songs:
                        if song in playlist_dict[playlist_name]:
                            songs_to_remove.append(song)

                    for song in songs_to_remove:
                        playlist_dict[playlist_name].remove(song)
                else:
                    playlist_dict[playlist_name] = []

                for song in failed_downloads:
                    if song not in playlist_dict[playlist_name]:
                        playlist_dict[playlist_name].append(song)

                with open(Controller.FAILED_DOWNLOADED_SONGS_FILE_PATH, "w") as file:
                    json.dump(playlist_dict, file, indent=4)

                break
            except InvalidCookieException:
                while True:
                    # Ask the user to double check the url
                    print("Exception thrown with url: {}".format(playlist_url))
                    url_correct = str(input("Was that url correct? (Will ask for new cookie if yes). If the url was "
                                            "correct but the webpage just didn't load properly, press r to try again (y/n/r): "))
                    if url_correct is "y":
                        os.remove(".cookie")
                        break
                    elif url_correct is "n":
                        playlist_url = str(input("Please enter the correct url: "))
                        break
                    elif url_correct is "r":
                        break
                    else:
                        print("Invalid input!")