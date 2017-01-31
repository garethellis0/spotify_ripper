from abc import ABCMeta, abstractmethod


class Downloader(metaclass=ABCMeta):
    @abstractmethod
    def download_songs(self, songs):
        """
        Downloads the songs contained in songs into a folder.
        The Downloads are mp3 files and are names according to their artist and title

        :param songs: A list of dictionaries, with each dictionary containing the information of a song.
                      Each dictionary must have fields for 'title', 'artist', 'album' and 'time'
        :return: A list of dictionaries representing any songs that failed to download, with each dictionary
                 containing the information of a song (like songs).
        """
        # TODO: multithread song operations from here

    @abstractmethod
    def _construct_url(self, song):
        """
        Takes a dictionary containing song information (must have 'title', 'artist', 'album' and 'time' fields)
        and returns the url corresponding to a search for this song

        :param song: A dictionary containing song information. Must have 'title', 'artist', 'album' and 'time' fields.
        :return: A String representation of a url corresponding to a search for this song
        """

    def _download_song(self, song_url):
        """
        Downloads the song at the given url as an mp3 file

        :param song_url: the url of the song
        :return: void
        """

    @staticmethod
    def get_ydl_opts():
        return {
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "320",
            }],
        }