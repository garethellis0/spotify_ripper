from __future__ import unicode_literals
from abc import ABCMeta, abstractmethod
import youtube_dl
import os
import re
import workerpool # TODO: include in setup script
import threading
from src.Util import Util


class DownloadJob(workerpool.Job):
    """
    Defines a job for downloading a song
    """
    def __init__(self, dl, song):
        self.song = song
        self.dl = dl
        self.lock = dl.lock
        self.folder_name = dl.folder_name

    def run(self):
        search_url = self.dl._construct_search_url(self.song)
        search_info = self.dl._get_search_info(search_url)
        best_url = Util.get_best_song_url(self.song, search_info)

        if best_url == "":
            with self.lock:
                self.dl.failed_downloaded_songs.append(self.song)
        else:
            if self.dl._download_song(best_url) is True:
                Util.rename_song_file(self.dl.download_path, self.song, best_url)
                Util.write_metadata(self.song, self.dl.download_path)
            else:
                with self.lock:
                    self.dl.failed_downloaded_songs.append(self.song)


class Downloader(metaclass=ABCMeta):
    """
    An abstract base class for Downloader objects.
    Classes that extend this class must only override construct_search_url
    and get_search_info
    """
    # FOR TESTING
    DOWNLOADED_MUSIC_FILE_PATH = os.path.dirname(os.path.realpath(__file__)) + "/../test/test_downloaded_music/"

    # DOWNLOADED_MUSIC_FILE_PATH = os.path.dirname(os.path.realpath(__file__)) + "/../downloaded_music/"

    def __init__(self, requested_songs, folder_name):
        """
        Creates a new Downloader object. Takes in a list of dictionaries of song info and the name of the folder
        for songs to be downloaded into.

        :param requested_songs: A list of dictionaries containing song information. Must have 'title',
                                'artist', 'album' and 'time' fields.
        :param folder_name: The name of the folder for songs to be downloaded into
        """
        self.requested_songs = list(requested_songs)
        self.folder_name = folder_name
        self.download_path = self.DOWNLOADED_MUSIC_FILE_PATH + folder_name + "/"

        # variables for statistics
        self.num_existing_songs = 0
        self.failed_downloaded_songs = []

        self.lock = threading.Lock()

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
        # make subfolder for this set of downloads
        try:
            os.mkdir(self.download_path)
            print("Creating download directory for " + self.folder_name + "...")
        except FileExistsError:
            print("Download folder already exists for " + self.folder_name + "...")

        os.chdir(self.download_path)
        self._remove_existing_songs_from_list()

        # no real benefit after ~10 threads since limited by download speeds
        pool = workerpool.WorkerPool(size=10)

        for song in self.requested_songs:
            job = DownloadJob(self, song)
            pool.put(job)

        pool.shutdown()
        pool.wait()

        return [self.num_existing_songs, self.failed_downloaded_songs]


    @abstractmethod
    def _construct_search_url(self, song):
        """
        Takes a dictionary containing song information (must have 'title', 'artist', 'album' and 'time' (in seconds) fields)
        and returns the url corresponding to a search for this song

        :param song: A dictionary containing song information. Must have 'title', 'artist', 'album' and 'time' (in seconds) fields.
                    All fields are strings except time, which is an int
        :return: A String representation of a url corresponding to a search for this song
        """

    @abstractmethod
    def _get_search_info(self, song_search_url):
        """
        Downloads the page source of the song_search_url, and returns a list of dictionaries containing
        the information for each search result. The dictionaries contain 'title' and 'url' fields.

        :param song_search_url: The url of a search for a song
        :return: A list of dictionaries, each containing the 'title' and 'url' info of each search result
        """

    def _download_song(self, song_url):
        """
        Downloads the song at the given url as an mp3 file. Returns true if the download was
        successful and false otherwise

        :param song_url: the url of the song
        :return: true if the song downloaded successfully, and false otherwise
        """
        with youtube_dl.YoutubeDL(self.get_ydl_opts()) as ydl:
            try:
                ydl.download([song_url])
                return True;
            except Exception:
                return False;


    def _remove_existing_songs_from_list(self):
        """
        Removes any songs that have already been downloaded by the program from the list of requested songs

        :return: void
        """
        songs_to_remove = []

        for song in self.requested_songs:
            filename = Util.get_song_filename(song)
            song_name_regex = re.escape(filename)

            for file in os.listdir(self.download_path):
                if re.match(song_name_regex, file):
                    songs_to_remove.append(song)
                    self.num_existing_songs += 1
                    break

        for song in songs_to_remove:
            self.requested_songs.remove(song)


    @staticmethod
    def get_ydl_opts():
        """
        Returns a dictionary containing the parameters/specifications for youtube-dl
        :return: A dictionary containing the parameters/specifications for youtube-dl
        """
        return {
            "format": "bestaudio/best",
            "quiet": "true",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        }
