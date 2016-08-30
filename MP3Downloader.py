from __future__ import unicode_literals
import youtube_dl
import urllib.request
import re
import os


class MP3Downloader:

    # Calls all functions to download mp3 files based on song information passed in
    # as a dictionary
    #
    # Params:
    #   songs - A dictionary of song information containing "Title", "Artist",
    #           "Album" and "Time", where all entries are strings
    def get_downloads(self, songs):
        search_urls = self._get_search_urls(songs)
        song_urls = self._get_song_urls(search_urls)
        self._download_songs(song_urls)

    # Takes a dictionary of song information, including "Title", "Artist",
    # "Album" and "Time" (all entries in the dictionary should be strings)
    # and returns a list of urls corresponding to searches for those songs
    #
    # All search URLs follow the same style of:
    # https://www.youtube.com/results?search_query=green+day+bang+bang
    def _get_search_urls(self, songs):
        #The first part of every search url
        url_start = "https://www.youtube.com/results?search_query="
        urls = []

        for song in songs:
            url = url_start + song["Artist"] + "+" + song["Title"] + "+" + "lyrics"
            url = url.replace(" ", "+")
            url = url.lower()
            urls.append(url)
        return urls

    # Takes a list of urls that correspond to searches for songs, and returns a list
    # of urls for the first result in each search
    #
    # Params:
    #     search_urls - A list of urls (strings) representing searches for songs
    #should prefers songs from artist's channel, similar time to Time, does not contain "cover" or "mix"
    def _get_song_urls(self, search_urls):
        song_urls = []
        url_beginning = "https://www.youtube.com"

        for url in search_urls:
            with urllib.request.urlopen(url) as response:
                html = response.read()

            #decodes html source from binary bytes to string
            source = html.decode("utf-8")

            #Youtube video urls have 11 character long unique id's
            url_terminations = re.findall("data-context-item-id=\"(.*?)\"", source)

            pattern = re.compile("href=\"\/watch\?v=...........")
            url_termination = re.search(pattern, source)
            url_termination = url_termination.group(0)
            url_termination = url_termination[6:]
            song_url = url_beginning + url_termination
            song_urls.append(song_url)

        return song_urls

    #Takes a list of urls of youtube videos (songs), and downloads the mp3 files
    #of those videos
    def _download_songs(self, urls):
        py_dir = os.path.dirname(os.path.realpath(__file__))
        path = py_dir + "/music"
        try:
            os.mkdir(path)
        except FileExistsError:
            print("path already exists")

        os.chdir(path)

        for url in urls:
            ydl_opts = {
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '320',
                }],
            }
            with youtube_dl.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])