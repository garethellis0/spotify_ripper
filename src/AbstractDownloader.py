from abc import ABCMeta, abstractmethod


class Downloader(metaclass=ABCMeta):
    @abstractmethod
    def __init__(self, requested_songs, folder_name):
        """
        Creates a new Downloader object. Takes in a list of dictionaries of song info and the name of the folder
        for songs to be downloaded into.

        :param requested_songs: A list of dictionaries containing song information. Must have 'title',
                                'artist', 'album' and 'time' fields.
        :param folder_name: The name of the folder for songs to be downloaded into
        """

    @abstractmethod
    def download_songs(self):
        """
        Downloads the songs passed upon object creation into a folder.
        The Downloads are mp3 files and are names according to their artist and title

        :return: A list of dictionaries representing any songs that failed to download, with each dictionary
                 containing the information of a song (like songs).
        """
        # TODO: multithread song operations from here

    @abstractmethod
    def _construct_search_url(self, song):
        """
        Takes a dictionary containing song information (must have 'title', 'artist', 'album' and 'time' fields)
        and returns the url corresponding to a search for this song

        :param song: A dictionary containing song information. Must have 'title', 'artist', 'album' and 'time' fields.
        :return: A String representation of a url corresponding to a search for this song
        """

    @abstractmethod
    def _get_search_info(self, song_search_url, max_num_searches):
        """
        Downloads the page source of the song_search_url, and returns a list of dictionaries containing
        the information for each search result. The dictionaries contain 'title' and 'url' fields.

        :param song_search_url: The url of a search for a song
        :return: A list of dictionaries, each containing the 'title' and 'url' info of each search result
        """

    def _download_song(self, song_url):
        """
        Downloads the song at the given url as an mp3 file

        :param song_url: the url of the song
        :return: void
        """

    @staticmethod
    def get_ydl_opts():
        """
        Returns a dictionary containing the parameters/specifications for youtube-dl
        :return: A dictionary containing the parameters/specifications for youtube-dl
        """
        return {
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "320",
            }],
        }