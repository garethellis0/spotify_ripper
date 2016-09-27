from __future__ import unicode_literals
from pytag import Audio
import youtube_dl
import urllib.parse
import urllib.request
import re
import os

class MP3Downloader:
    # Takes in a list of dictionaries, with each dictionary containing the info for one song
    # Dictionaries must contain keys for "Title", "Artist", "Album", and "Time"
    # All values in the dictionaries must be of type String
    def __init__(self, songs):
        self.songs = songs

        # The path to the folder where the songs will be downloaded
        self.download_path = os.path.dirname(os.path.realpath(__file__)) + "/music/"

        self.total_songs_requested = len(songs)
        self.total_existing_songs = 0
        self.total_downloaded_songs = 0
        self.total_unfound_songs = 0
        self.total_unfound_songs_info = []

    # Attempts to download, rename, and write metadata for all songs
    # given in the songs dictionary.
    # Songs that fail this process will be skipped and be printed in the summary at the end of the program
    def get_downloads(self):
        self._remove_existing_songs()
        self._get_search_urls()
        self._get_song_urls()
        self._download_songs()
        self._rename_songs()
        self._write_metadata()
        self._print_summary()

    # Checks for songs that already exist in the download folder, and removes them
    # from the list of songs to be downloaded
    def _remove_existing_songs(self):
        print("Checking for existing songs...")
        songs_to_remove = []

        # Identify songs that already exist
        for song in self.songs:
            filename = self._remove_invalid_chars(self._get_filename(song))
            song_name_regex = re.escape(filename)

            for filename in os.listdir(self.download_path):
                if re.match(song_name_regex, filename):
                    print("The song \"%s\" already exists. Skipping this song." % self._get_filename(song))
                    songs_to_remove.append(song)
                    self.total_existing_songs += 1
                    break

        # Must be done outside song loop, otherwise indexing gets mixed up
        for song in songs_to_remove:
            self.songs.remove(song)

    # Gets the youtube search url for each song in the list of songs
    # and adds it to the songs dictionary under a new key called "search_url"
    # Urls are created in the form: https://www.youtube.com/results?search_query=Artist+Title+lyrics
    def _get_search_urls(self):
        url_start = "https://www.youtube.com/results?search_query="
        print("Retrieving search urls...")

        for song in self.songs:
            search = song["Artist"] + "+" + song["Title"] + "+" + "lyrics"
            # encodes special chars to "url form"
            search_url = url_start + urllib.parse.quote_plus(search)
            search_url = search_url.replace(" ", "+")
            search_url = search_url.lower()
            song["search_url"] = search_url

    # Determines the best youtube video for each song in the songs list,
    # and adds the video's url to the song's dictionary under a new key
    # called "song_url". If a suitable video is not found, the song is removed
    # from the list of songs to be downloaded and noted in the summary at the
    # end of the program
    #
    # Youtube video urls have 11 character long unique id's
    # Urls are created in the form: https://www.youtube.com/watch?v=XXXXXXXXXXX
    # where "X" represents a random character
    def _get_song_urls(self):
        print("Retrieving song urls...")
        max_vids_to_eval = 10
        songs_to_skip = []

        for song in self.songs:
            search_url = song["search_url"]
            with urllib.request.urlopen(search_url) as response:
                html = response.read()

            # decodes html source from binary bytes to string
            search_source = html.decode("utf-8", "ignore")

            vid_info = self._get_vid_info(search_source, max_vids_to_eval)
            best_song_url = self._get_best_song_url(song, vid_info)

            if best_song_url is "":
                print("Unable to find a suitable video for %s. Skipping this song." % (self._get_filename(song)))
                songs_to_skip.append(song)
                self.total_unfound_songs += 1
                self.total_unfound_songs_info.append(self._get_filename(song))
            else:
                song["song_url"] = best_song_url

        # Must be done outside the song loop to avoid indexing issues
        for song in songs_to_skip:
            self.songs.remove(song)

    # Takes the page source of a list of youtube search results for a song, and a positive integer
    # representing the size of the list of info return. Returns a list of dictionaries, with each dictionary
    # containing key-value pairs for "title" and "url"
    def _get_vid_info(self, search_source, max_num_vids):
        url_beginning = "https://www.youtube.com/watch?v="
        vids_to_eval = []
        index = 1

        # Isolate the list of results in the source
        results_source = re.split(r"<ol id=\"item-section-.*?\" class=\"item-section\">", search_source)[1]
        results_source = re.split(r"<\/ol>\n<\/li>\n<\/ol>", results_source)[0]

        # split by video in list, returns the type of entry (video, playlist, channel)
        results_source = re.split(r"<li><div class=\"yt-lockup yt-lockup-tile yt-lockup-(.*?) vve-check clearfix.*?\"",
                                  results_source)

        while len(vids_to_eval) < max_num_vids and index < len(results_source) - 1:
            source_type = results_source[index]
            source = results_source[index + 1]

            if source_type == "video":
                video_url = re.findall(r"href=\"\/watch\?v=(.*?)\"", source)[0]
                video_url = url_beginning + video_url
                video_title = re.findall(r"title=\"(.*?)\"", source)[2]
                video_title = self._html_decode(video_title)

                vids_to_eval.append({
                    "url": video_url,
                    "title": video_title
                })

            index += 2

        return vids_to_eval

    # Given a list of vid info (video title and url) for a song, returns the first song in
    # the list that is not a cover, music video, live performance, reaction video, behind the scenes, or instrumental.
    # Returns the url of the best video, and returns and empty string if no video meets the criteria
    def _get_best_song_url(self, song, vid_info):
        for vid in vid_info:
            song_title_and_artist = song['Title'] + " " + song['Artist']
            vid_title = vid["title"]
            url = vid["url"]

            # If the video a cover (not by the artist)
            if re.search(r"(?<![a-z])cover(?![a-z])", vid_title, re.IGNORECASE) is not None \
                    and re.search(r"(?<![a-z])cover(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
                continue
            # if the video is a live performance
            elif re.search(r"(?<![a-z])live(?![a-z])", vid_title, re.IGNORECASE) is not None \
                    and re.search(r"(?<![a-z])live(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
                continue
            # If the video is a music video
            elif (re.search(r"music([^a-z])video", vid_title, re.IGNORECASE) is not None
                  and re.search(r"music([^a-z])video", song_title_and_artist, re.IGNORECASE) is None) \
                    or (re.search(r"(?<![a-z])official(?![a-z])", vid_title, re.IGNORECASE) is not None
                        and re.search(r"(?<![a-z])official(?![a-z])", song_title_and_artist, re.IGNORECASE) is None
                        and re.search(r"(?<![a-z])lyric(s)?(?![a-z])", vid_title, re.IGNORECASE) is None):
                continue
            # If the video is an instrumental
            elif re.search(r"(?<![a-z])instrumental(?![a-z])", vid_title, re.IGNORECASE) is not None \
                    and re.search("(?<![a-z])instrumental(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
                continue
            # If the video is a reaction video
            elif re.search(r"(?<![a-z])reaction(?![a-z])", vid_title, re.IGNORECASE) is not None \
                    and re.search(r"(?<![a-z])reaction(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
                continue
            # If the video is a behind the scenes video
            elif re.search(r"(?<![a-z])Behind(?![a-z]).(?<![a-z])The(?![a-z]).(?<![a-z])Scenes(?![a-z])", vid_title,
                           re.IGNORECASE) is not None:
                continue
            else:
                return url

        return ""

    # For each song url in the songs dictionary, downloads the corresponding song as an mp3 file
    def _download_songs(self):
        print ("Attempting to download songs...")

        # make a folder to download the songs to
        try:
            os.mkdir(self.download_path)
        except FileExistsError:
            print("Download folder already exists")

        os.chdir(self.download_path)

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
                print("Attempting to download: %s\n"
                      "Video url: %s" % (self._get_filename(song), url))
                ydl.download([url])
                self.total_downloaded_songs += 1

    # Renames each downloaded song from the songs dictionary to the form "Artist - Title"
    def _rename_songs(self):
        print("Renaming songs...")

        for song in self.songs:
            new_name = self._get_filename(song)
            new_name = self._html_decode(new_name)
            new_name = self._remove_invalid_chars(new_name)
            song["new_name"] = new_name
            song_regex = r".*?-(" + re.escape(song["song_url"][-11:]) + r").*"

            # find the downloaded file in the dowload folder and rename it to the proper name
            for filename in os.listdir(self.download_path):
                if re.match(song_regex, filename):
                    os.rename(self.download_path + filename, self.download_path + new_name)
                    break

    # Writes title, artist, and album metadata for each downloaded song from the songs dictionary,
    # and changes file permissions so everyone has access (access code 777)
    def _write_metadata(self):
        print("Writing metadata...")

        for song in self.songs:
            print("writing data for %s" % self._get_filename(song))
            path_to_song = self.download_path + song["new_name"]
            audio = Audio(path_to_song)
            audio.write_tags({
                "title": song["Title"],
                "artist": song["Artist"],
                "album": song["Album"]
            })

            # access code preceded by 0o to represent octal number
            os.chmod(path_to_song, 0o777)

    # Prints a summary of information about the download process
    # Prints:
    #   - How many songs were requested for download
    #   - How many songs were successfully downloaded
    #   - How many already existed and were skipped
    #   - How many songs did not have a suitable video and were therefore skipped
    def _print_summary(self):
        print("\n================= Summary =================")
        print("%d songs requested for download" % self.total_songs_requested)
        print("%d songs were downloaded successfully" % self.total_downloaded_songs)
        print("%d songs already existed and were skipped" % self.total_existing_songs)
        print("%d exceptions encountered" % self.total_unfound_songs)

        for unfound_song in self.total_unfound_songs_info:
            print("Could not find a good download for \"%s\". This song was skipped." % unfound_song)

        print("============= Process Complete =============")

    # Given a dictionary of song info, returns the filename for the song
    # The dictionary must contain keys for "Artist", "Title", "Album", and "Time"
    def _get_filename(self, song):
        return song["Artist"] + " - " + song["Title"] + ".mp3"

    # Returns the ASCII decoded version of given HTML string
    def _html_decode(self, s):
        html_codes = [
            ["'", '&#39;'],
            ['"', '&quot;'],
            ['>', '&gt;'],
            ['<', '&lt;'],
            ['&', '&amp;']
        ]
        for code in html_codes:
            s = s.replace(code[1], code[0])

        return s

    # Returns a string with invalid characters replaced with something else
    # Replaces "/" with "_"
    def _remove_invalid_chars(self, s):
        invalid_chars = [["/", "_"]]
        for char in invalid_chars:
            s = s.replace(char[0], char[1])

        return s
