from src.AbstractDownloader import Downloader
from src.Util import Util
import urllib.parse
import urllib.request
import re


class SoundcloudDownloader(Downloader):
    SEARCH_URL_ROOT = "https://soundcloud.com/search/sounds?q=" # specifies tracks
    SONG_URL_RESULT_ROOT = "https://soundcloud.com/"
    MAX_NUM_SEARCH_RESULTS = 10

    def _construct_search_url(self, song):
        """
        Takes a dictionary containing song information (must have 'title', 'artist', 'album' and 'time' fields)
        and returns the url corresponding to a search for this song

        :param song: A dictionary containing song information. Must have 'title', 'artist', 'album' and 'time' fields.
        :return: A String representation of a url corresponding to a search for this song
        """
        # https://soundcloud.com/search?q=Barns%20Courtney%20hellfire%20lyrics
        # https://soundcloud.com/search?q=Royal%20Tusk%20Curse%20The%20Weather

        search = song["artist"] + " " + song["title"]
        search_url = self.SEARCH_URL_ROOT + urllib.parse.quote(search)
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
        results_source = re.split(r"<div class=\"searchResultGroupHeading\">", search_source)[1]
        results_source = re.split(r"</ul>", results_source, 1)[0]

        # split by search result
        results_source = re.split(r"<div class=\"searchItem\">", results_source)[1:]

        # This code theoretically works, but urllib can't access all of Soundclouds
        # websource because it thinks it's an invalid browser of something

        index = 0
        while len(search_info) < self.MAX_NUM_SEARCH_RESULTS and index < len(results_source):
            source = results_source[index]

            artist = re.findall(r"<span class=\"soundTitle_+usernameText\">(.*)</span>", source)[0]
            title = re.findall(r"<span class=\"\">(.*)</span>", source)[0]
            url = re.findall(r"<a class=\"soundTitle_+title sc-link-dark\" href=\"(.*)\">", source)[0]

            title = Util.html_to_ascii(artist + " " + title)
            url = self.SONG_URL_RESULT_ROOT + url

            search_info.append({
                "url": url,
                "title": title,
                "time": None
            })

            index += 1

        return search_info
