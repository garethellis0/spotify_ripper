from src.AbstractDownloader import Downloader
import youtube_dl
import os


class YouTubeDownloader(Downloader):
    #def __init__(self, requested_songs, folder_name):

    def _construct_search_url(self, song):
        """
        Takes a dictionary containing song information (must have 'title', 'artist', 'album' and 'time' fields)
        and returns the url corresponding to a search for this song

        :param song: A dictionary containing song information. Must have 'title', 'artist', 'album' and 'time' fields.
        :return: A String representation of a url corresponding to a search for this song
        """

    def _get_search_info(self, song_search_url, max_num_searches):
        """
        Downloads the page source of the song_search_url, and returns a list of dictionaries containing
        the information for each search result. The dictionaries contain 'title' and 'url' fields.

        :param song_search_url: The url of a search for a song
        :return: A list of dictionaries, each containing the 'title' and 'url' info of each search result
        """

    # def _remove_existing_songs_from_list(self):
    #     existing_songs_file = open(self.downloaded_songs_filepath, 'r')
    #     existing_songs = existing_songs_file.readlines()
    #     print(existing_songs)

    # TODO: Summary function / dataype?

