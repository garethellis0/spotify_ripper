from abc import ABCMeta, abstractmethod
import youtube_dl
import mmap
import os
from src.Util import Util


class Downloader(metaclass=ABCMeta):
    """
    An abstract base class for Downloader objects.
    Classes that extend this class must only override ...

    """

    # TODO: finish comment
    DOWNLOADED_SONGS_FILE_PATH = os.path.dirname(os.path.realpath(__file__)) + "/../.downloaded_songs.txt"
    DOWNLOADED_PLAYLISTS_FILE_PATH = os.path.dirname(os.path.realpath(__file__)) + "/../.downloaded_playlists.txt"
    DOWNLOADED_MUSIC_FILE_PATH = os.path.dirname(os.path.realpath(__file__)) + "/../downloaded_music/"
    MAX_NUM_SEARCH_RESULTS = 10

    def __init__(self, requested_songs, folder_name):
        """
        Creates a new Downloader object. Takes in a list of dictionaries of song info and the name of the folder
        for songs to be downloaded into.

        :param requested_songs: A list of dictionaries containing song information. Must have 'title',
                                'artist', 'album' and 'time' fields.
        :param folder_name: The name of the folder for songs to be downloaded into
        """
        self.requested_songs = requested_songs
        self.folder_name = folder_name
        self.download_path = self.DOWNLOADED_MUSIC_FILE_PATH + folder_name + "/"

        try:
            os.mkdir(self.DOWNLOADED_MUSIC_FILE_PATH)
            print("Creating download directory...")
        except FileExistsError:
            print("Download directory already exists...")

    def download_songs(self):
        """
        Downloads the songs passed upon object creation into a folder.
        The Downloads are mp3 files and are names according to their artist and title

        :return: A list of dictionaries representing any songs that failed to download, with each dictionary
                 containing the information of a song (like songs).
        """
        # Create folder for downloads
        try:
            os.mkdir(self.download_path)
            print("Creating download directory for " + self.folder_name + "...")
        except FileExistsError:
            print("Download folder already exists for " + self.folder_name + "...")

        os.chdir(self.download_path)
        self._remove_existing_songs_from_list()

        for song in self.requested_songs:
            search_url = self._construct_search_url(song)
            search_info = self._get_search_info(search_url, self.MAX_NUM_SEARCH_RESULTS)
            best_url = Util.get_best_song_url(song, search_info)
            if best_url == "":
                continue
                # TODO: handle song that can't be found

            self._download_song(best_url)


        # download songs
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
        :return: true if the song downloaded successfully, and false otherwise
        """
        with youtube_dl.YoutubeDL(Downloader.get_ydl_opts()) as ydl:
            try:
                # TODO: name song with ydl opts?
                ydl.download(song_url)
                return False
            except Exception:
                return False
                # TODO: track failed song stats?
                # TODO: may need to make access to marking file as failed threadsafe

    def _remove_existing_songs_from_list(self):
        """
        Removes any songs that have already been downloaded by the program from the list of requested songs

        :return: void
        """
        with open(self.DOWNLOADED_SONGS_FILE_PATH, 'rb', 0) as file, \
                mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as s:
            print("READING FILE")
            for song in self.requested_songs:
                name = Util.get_song_filename(song['artist'], song['title'])
                if s.find(name.encode(encoding='UTF-8')) != -1:
                    # TODO: create constant for encoding?
                    # TODO: add song to summary report? Keep track of removed song?
                    self.requested_songs.remove(song)


    # TODO: add Summary function / dataype?

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
