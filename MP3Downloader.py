from __future__ import unicode_literals
from pytag import Audio
import youtube_dl
import urllib.parse
import urllib.request
import re
import os


class MP3Downloader:

    # Takes in a dictionary of songs containing the Title, Artist,
    # Album, and Time
    def __init__(self, songs):
        self.songs = songs
        #The path to the folder where the songs will be downloaded
        self.path = os.path.dirname(os.path.realpath(__file__)) + "/music/"

    # Calls all functions to download mp3 files based on song information passed in
    # as a dictionary
    def get_downloads(self):
        self._get_search_urls()
        self._get_song_urls()
        self._download_songs()
        self._rename_songs()
        self._set_metadata()

    # Gets the youtube search url for each song in the dictionary,
    # and adds it to the dictionary as "search_url"
    def _get_search_urls(self):
        #The first part of every search url
        url_start = "https://www.youtube.com/results?search_query="
        print ("Retrieving search urls...")

        for song in self.songs:
            search = song["Artist"] + "+" + song["Title"] + "+" + "lyrics"
            #encodes special chars to "url form"
            search_url = url_start + urllib.parse.quote_plus(search)
            search_url = search_url.replace(" ", "+")
            search_url = search_url.lower()
            song["search_url"] = search_url

    # Using the youtube search url for each song in the songs dictionary,
    # gets the url for the top search result for that song and adds it to
    # the dictionary
    #
    # Youtube video urls have 11 character long unique id's
    def _get_song_urls(self):
        url_beginning = "https://www.youtube.com/watch?v="
        print("Retrieving song urls...")

        for song in self.songs:
            url = song["search_url"]
            with urllib.request.urlopen(url) as response:
                html = response.read()

            # decodes html source from binary bytes to string
            source = html.decode("utf-8", "ignore")

            #unique url termination of first video in search results
            url_termination = re.findall("href=\"\/watch\?v=(.*?)\"", source)[0]
            song_url = url_beginning + url_termination
            song["song_url"] = song_url

    # For each song url in the songs dictionary, downloads the corresponding song as an mp3 file
    def _download_songs(self):
        #make a folder to download the songs to
        try:
            os.mkdir(self.path)
        except FileExistsError:
            print("path already exists")

        os.chdir(self.path)

        for song in self.songs:
            url = song["song_url"]
            ydl_opts = {
                "format": "bestaudio/best",
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "320",
                }],
            }
            # download the song
            with youtube_dl.YoutubeDL(ydl_opts) as ydl:
                print ("Attemtping to download: %s" %url)
                ydl.download([url])

    # Renames each downloaded song from the songs dictionary to the form "Artist - Title"
    def _rename_songs(self):
        for song in self.songs:
            # find the downloaded file in the path and rename it to the proper name
            for filename in os.listdir(self.path):
                my_regex = r".*?-(" + re.escape(song["song_url"][-11:]) + r").*"
                new_name = song["Artist"] + " - " + song["Title"] + ".mp3"

                if re.match(my_regex, filename):
                    os.rename(self.path + filename, self.path + new_name)
                    song["new_name"] = new_name
                    print("Renaming song to: %s" % new_name)
                    break

    # Writes title, artist, and album metadata for each downloaded song from the songs dictionary
    def _set_metadata(self):
        print("Writing metadata...")
        for song in self.songs:
            path_to_song = self.path + song["new_name"]
            audio = Audio(path_to_song)
            audio.write_tags({
                "title": song["Title"],
                "artist": song["Artist"],
                "album": song["Album"]
            })

