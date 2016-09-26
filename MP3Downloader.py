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

        self.total_songs_requested = len(songs)
        self.total_existing_songs = 0
        self.total_downloaded_songs = 0
        self.total_unfound_songs = 0
        self.total_unfound_songs_info = []

    # Calls all functions to download mp3 files based on song information passed in
    # as a dictionary
    def get_downloads(self):
        self._removeExistingSongs()
        self._get_search_urls()
        self._get_song_urls()
        self._download_songs()
        self._rename_songs()
        self._write_metadata()
        self._print_summary()


    # Checks for songs that already exist in the download path, and removes them
    # from the list of songs to be downloaded
    def _removeExistingSongs(self):
        print ("Checking for existing songs...")
        songs_to_remove = []

        # Identify songs that already exist
        for song in self.songs:
            filename = self._remove_invalid_chars(song["Artist"] + " - " + song["Title"]) + ".mp3"
            song_name_regex = re.escape(filename)

            for filename in os.listdir(self.path):
                if re.match(song_name_regex, filename):
                    print("The song \"%s - %s\" already exists. Skipping this song." %(song["Artist"], song["Title"]))
                    songs_to_remove.append(song)
                    self.total_existing_songs += 1
                    break

        # Remove the pre-existing songs from the songs dictionary
        # Cannot be done in the first loop because removing items
        # during the check for songs messes up the indexing and not all
        # songs are properly detected
        for song in songs_to_remove:
            self.songs.remove(song)


    # Gets the youtube search url for each song in the dictionary,
    # and adds it to the dictionary as "search_url"
    # Urls are created in the form: https://www.youtube.com/results?search_query=Artist+Title+lyrics
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
    # Urls are created in the form: https://www.youtube.com/watch?v=XXXXXXXXXXX
    # where "X" represents a random character part of the unique video id
    def _get_song_urls(self):
        url_beginning = "https://www.youtube.com/watch?v="
        max_vids_to_eval = 10
        songs_to_skip = []
        print("Retrieving song urls...")

        for song in self.songs:
            url = song["search_url"]
            with urllib.request.urlopen(url) as response:
                html = response.read()

            # decodes html source from binary bytes to string
            search_source = html.decode("utf-8", "ignore")

            vid_info = self._get_vid_info(search_source, max_vids_to_eval)
            best_song_url_termination = self._get_best_song_url(song, vid_info)

            if best_song_url_termination is "":
                print("Unable to find a suitable video for %s - %s, skipping this song." %(song['Artist'], song['Title']))
                songs_to_skip.append(song)
                self.total_unfound_songs += 1
                self.total_unfound_songs_info.append(song["Artist"] + " - " + song["Title"])
            else:
                #url_terminations = re.findall("href=\"\/watch\?v=(.*?)\"", search_source)[0]
                #video_titles = re.findall("title=\"(.*?)\"", search_source)
                song_url = url_beginning + best_song_url_termination
                song["song_url"] = song_url

        for song in songs_to_skip:
            self.songs.remove(song)


    # Given a youtube search url extracts the title and url termination (the 11-character long unique
    # id at the end of each video's url) and returns the results as a list of dictionaries,
    # with each video's info in a separate dictionary
    # @Param search_source the web source of the youtube search page for the song to collect vid info from
    # @Param max_num_vids the maximum number of dictionaries of vid info the function will return
    # @Returns a list of dictionaries containing the title and url termination for each video
    def _get_vid_info(self, search_source, max_num_vids):
        vids_to_eval = []
        index = 1

        # Isolate the list of results in the source
        results_source = re.split(r"<ol id=\"item-section-.*?\" class=\"item-section\">", search_source)[1]
        results_source = re.split(r"<\/ol>\n<\/li>\n<\/ol>", results_source)[0]

        # split by video in list, returns the type of entry (video, playlist, channel)
        results_source = re.split(r"<li><div class=\"yt-lockup yt-lockup-tile yt-lockup-(.*?) vve-check clearfix.*?\"", results_source)

        while len(vids_to_eval) < max_num_vids and index < len(results_source) - 1:
            source_type = results_source[index]
            source = results_source[index + 1]

            if source_type == "video":
                video_url = re.findall(r"href=\"\/watch\?v=(.*?)\"", source)[0]
                video_title = re.findall(r"title=\"(.*?)\"", source)[2]
                video_title = self._html_decode(video_title)

                # print ("%i, %i" %(len(re.findall(r"title=\"(.*?)\" rel=\".*?\" aria-describedby=\".*?\"", source)), len(re.findall(r"href=\"\/watch\?v=(.*?)\"", source))))
                # This regex performs inconsistently, don't know why.
                #video_title = re.findall(r"title=\"(.*?)\" rel=\".*?\" aria-describedby=\".*?\"", source)[0]

                vids_to_eval.append({
                    "url" : video_url,
                    "title" : video_title
                })

            index += 2

        return vids_to_eval

    # Given a list of vid info (video title and url termination) for a song, returns the first song in
    # the list that is not a cover, music video, live performance, reaction video, behind the scenes, or instrumental
    # @Param song the dictionary with the info for the song whose videos are being evaluated
    # @Param vid_info the list of dictionaries containing info (title, url termination) for the
    #        videos to be evaluated
    # @Returns the url termination of the first video in the list that meets all criteria
    #          (not a music video, live performance, cover, reaction video, behind the scenes, or instrumental),
    #          or an empty string "" if no video meets the criteria
    def _get_best_song_url(self, song, vid_info):
        for vid in vid_info:
            song_title_and_artist = song['Title'] + " " + song['Artist']
            vid_title = vid["title"]
            url = vid['url']

            # If the video a cover (not by the artist)
            if (re.search(r"(?<![a-z])cover(?![a-z])", vid_title, re.IGNORECASE) is not None\
                    and re.search(r"(?<![a-z])cover(?![a-z])", song_title_and_artist, re.IGNORECASE) is None):
                continue
            # if the video is a live performance
            elif re.search(r"(?<![a-z])live(?![a-z])", vid_title, re.IGNORECASE) is not None\
                    and re.search(r"(?<![a-z])live(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
                continue
            # If the video is a music video
            elif (re.search(r"music([^a-z])video", vid_title, re.IGNORECASE) is not None\
                    and re.search(r"music([^a-z])video", song_title_and_artist, re.IGNORECASE) is None)\
                    or (re.search(r"(?<![a-z])official(?![a-z])", vid_title, re.IGNORECASE) is not None\
                    and re.search(r"(?<![a-z])official(?![a-z])", song_title_and_artist, re.IGNORECASE) is None\
                    and (re.search(r"(?<![a-z])lyric(?![a-z])", vid_title, re.IGNORECASE) is None\
                        or re.search(r"(?<![a-z])lyrics(?![a-z])", vid_title, re.IGNORECASE) is None)):
                continue
            # If the video is an instrumental
            elif re.search(r"(?<![a-z])instrumental(?![a-z])", vid_title, re.IGNORECASE) is not None\
                    and re.search("(?<![a-z])instrumental(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
                continue
            # If the video is a reaction video
            elif re.search(r"(?<![a-z])reaction(?![a-z])", vid_title, re.IGNORECASE) is not None\
                    and re.search(r"(?<![a-z])reaction(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
                continue
            #If the video is a behind the scenes video
            elif re.search(r"(?<![a-z])Behind(?![a-z]).(?<![a-z])The(?![a-z]).(?<![a-z])Scenes(?![a-z])", vid_title, re.IGNORECASE) is not None:
                continue
            else:
                return url

        return ""


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
                self.total_downloaded_songs += 1


    # Renames each downloaded song from the songs dictionary to the form "Artist - Title"
    def _rename_songs(self):
        print ("Renaming songs...")

        for song in self.songs:
            # find the downloaded file in the path and rename it to the proper name
            for filename in os.listdir(self.path):
                my_regex = r".*?-(" + re.escape(song["song_url"][-11:]) + r").*"
                new_name = song["Artist"] + " - " + song["Title"] + ".mp3"
                new_name = self._html_decode(new_name)
                new_name = self._remove_invalid_chars(new_name)

                if re.match(my_regex, filename):
                    os.rename(self.path + filename, self.path + new_name)
                    song["new_name"] = new_name
                    break

    # Writes title, artist, and album metadata for each downloaded song from the songs dictionary,
    # and changes file permissions so everyone has access (access code 777)
    def _write_metadata(self):
        print("Writing metadata...")
        for song in self.songs:
            print ("writing data for %s" %song["Title"])
            path_to_song = self.path + song["new_name"]
            audio = Audio(path_to_song)
            audio.write_tags({
                "title": song["Title"],
                "artist": song["Artist"],
                "album": song["Album"]
            })

            # access code preceded by 0o to represent octal number
            os.chmod(path_to_song, 0o777);

    # Returns the ASCII decoded version of given HTML string.
    # Able to decode
    def _html_decode(self, s):
        htmlCodes = [
                ["'", '&#39;'],
                ['"', '&quot;'],
                ['>', '&gt;'],
                ['<', '&lt;'],
                ['&', '&amp;']
            ]
        for code in htmlCodes:
            s = s.replace(code[1], code[0])

        return s


    # Prints a summary of information about the download process
    # Prints:
    #   - How many songs were requested for download
    #   - How many songs were successfully downloaded
    #   - How many already existed and were skipped
    #   - How many songs did not have a suitable video and were therefore skipped
    def _print_summary(self):
        print("\n============== Summary ==============")
        print("%d songs requested" %self.total_songs_requested)
        print("%d songs were downloaded successfully. %d already existed and were skipped" %(self.total_downloaded_songs, self.total_existing_songs))
        print("%d exceptions encountered" %self.total_unfound_songs)

        for unfound_song in self.total_unfound_songs_info:
            print("Could not find a good download for \"" + unfound_song + "\". This song was skipped.")

        print("============== Process Complete ==============")

    # returns a new string with invalid chars ("/") replaced with underscores
    # @Param s the string to remove chars from
    # @Returns a string with the invalid chars removed
    def _remove_invalid_chars(self, s):
        invalid_chars = [["/", "_"]]
        for char in invalid_chars:
            s = s.replace(char[0], char[1])

        return s
