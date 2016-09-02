# asdasdasd-*- coding: <utf-8> -*-

from __future__ import unicode_literals
import youtube_dl
import urllib.parse
import urllib.request
import re
import os


class MP3Downloader:

    def __init__(self, songs):
        self.songs = songs



    # Calls all functions to download mp3 files based on song information passed in
    # as a dictionary
    #
    # Params:
    #   songs - A dictionary of song information containing "Title", "Artist",
    #           "Album" and "Time", where all entries are strings
    def get_downloads(self):
        search_urls = self._get_search_urls()
        song_urls = self._get_song_urls(search_urls)
        self._download_songs(song_urls)

    # Takes a dictionary of song information, including "Title", "Artist",
    # "Album" and "Time" (all entries in the dictionary should be strings)
    # and returns a list of urls corresponding to searches for those songs
    #
    # All search URLs follow the same style of:
    # https://www.youtube.com/results?search_query=green+day+bang+bang
    def _get_search_urls(self):
        #The first part of every search url
        url_start = "https://www.youtube.com/results?search_query="
        urls = []

        for song in self.songs:
            search = song["Artist"] + "+" + song["Title"] + "+" + "lyrics"
            #encodes special chars to "url form"
            url = url_start + urllib.parse.quote_plus(search)
            url = url.replace(" ", "+")
            url = url.lower()
            urls.append(url)
        print (urls)
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

        index = 0
        for url in search_urls:
            # # checks if the url has any non-ascii chars,
            # # since python needs to encode chars to send url read request
            # # char could potentially be substituted?
            # try:
            #     tmp = url.encode("ascii")
            # except UnicodeEncodeError:
            #     failed_song_title = self.songs[index]["Title"]
            #     failed_song_artist = self.songs[index]["Artist"]
            #     print("The url for the song \"%s\" by %s contains non-ASCII characters, so the "
            #           "song could not be downloaded" % (failed_song_title, failed_song_artist))
            #     del self.songs[index]
            #     continue

            with urllib.request.urlopen(url) as response:
                html = response.read()

            # decodes html source from binary bytes to string
            source = html.decode("utf-8", "ignore")
            #print(source)

            #Youtube video urls have 11 character long unique id's

            #to be used to select songs later
            #url_terminations = re.findall("data-context-item-id=\"(.*?)\"", source)
            print (url)
            pattern = re.compile("href=\"\/watch\?v=...........")
            url_termination = re.search(pattern, source)
            url_termination = url_termination.group(0)
            url_termination = url_termination[6:]
            song_url = url_beginning + url_termination
            song_urls.append(song_url)
            index += 1
        return song_urls

    #Takes a list of urls of youtube videos (songs), and downloads the mp3 files
    #of those videos
    def _download_songs(self, urls):
        py_dir = os.path.dirname(os.path.realpath(__file__))
        path = py_dir + "/music/"
        try:
            os.mkdir(path)
        except FileExistsError:
            print("path already exists")

        os.chdir(path)

        index = 0
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
                info_dict = ydl.extract_info(url, download=False)
                song_id = url[-11:]
                video_title = info_dict.get('title', None)
                full_default_name = video_title + "-" + song_id + ".mp3"
                proper_name = self.songs[index]["Artist"] + " - " + self.songs[index]["Title"]

                #download the song
                ydl.download([url])

                #find the downloaded file in the path and rename it to the proper name
                for filename in os.listdir(path):
                    my_regex = r'.*?-(' + re.escape(song_id) + r").*"

                    if re.match(my_regex, filename):
                        os.rename(path + filename, path + proper_name)
                        print ("Renaming song to: %s" %proper_name)
                        break
            index += 1
