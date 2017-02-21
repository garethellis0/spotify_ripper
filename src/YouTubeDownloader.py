from src.AbstractDownloader import Downloader
from src.Util import Util
import urllib.parse
import urllib.request
import re


class YouTubeDownloader(Downloader):
    SEARCH_URL_ROOT = "https://www.youtube.com/results?search_query="
    SONG_URL_RESULT_ROOT = "https://www.youtube.com/watch?v="
    MAX_NUM_SEARCH_RESULTS = 10

    def _construct_search_url(self, song):
        """
        Takes a dictionary containing song information (must have 'title', 'artist', 'album' and 'time' fields)
        and returns the url corresponding to a search for this song

        :param song: A dictionary containing song information. Must have 'title', 'artist', 'album' and 'time' fields.
        :return: A String representation of a url corresponding to a search for this song
        """
        search = song["artist"] + " " + song["title"] + " " + "lyrics"
        search_url = self.SEARCH_URL_ROOT + urllib.parse.quote_plus(search)
        search_url = search_url.lower()

        return search_url

    def _get_search_info(self, song_search_url):
        """
        Downloads the page source of the song_search_url, and returns a list of dictionaries containing
        the information for each search result. The dictionaries contain 'title', 'url', and 'time' (in seconds) fields.

        :param song_search_url: The url of a search for a song
        :return: A list of dictionaries, each containing the 'title', 'url', and 'time' (in seconds) info of each search result
        """
        with urllib.request.urlopen(song_search_url) as response:
            html = response.read()

        # decodes html source from binary bytes to string
        search_source = html.decode("UTF-8", "ignore")

        # parse source for vid info
        search_info = []

        # Isolate the list of results in the source
        results_source = re.split(r"<ol id=\"item-section-.*?\" class=\"item-section\">", search_source)[1]
        results_source = re.split(r"<div class=\"branded-page-box search-pager.*\">", results_source, 1)[0]

        # split by video in list, returns the type of entry (video, playlist, channel)
        results_source = re.split(r"<li><div class=\"yt-lockup yt-lockup-tile yt-lockup-(.*?) vve-check clearfix.*?\"",
                                  results_source)[1:]

        index = 0
        while len(search_info) < self.MAX_NUM_SEARCH_RESULTS and index < len(results_source) - 1:
            source_type = results_source[index]
            source = results_source[index + 1]

            if source_type == "video":
                video_url = re.findall(r"href=\"\/watch\?v=(.*?)\"", source)[0]
                video_url = self.SONG_URL_RESULT_ROOT + video_url
                video_title = re.findall(r"title=\"(.*?)\"", source)[2]
                video_title = Util.html_to_ascii(video_title)
                video_time = re.findall(r"Duration: (\d+:\d+)", source)[0]
                video_time = re.split(r":", video_time)
                video_time = int(video_time[0]) * 60 + int(video_time[1])

                search_info.append({
                    "url": video_url,
                    "title": video_title,
                    "time": video_time
                })

            index += 2

        return search_info
