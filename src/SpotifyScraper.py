import re
import time
from selenium import webdriver
from src.Util import Util


class InvalidCookieException(Exception):
    pass


class SpotifyScraper:
    def __init__(self, playlist_url=None, cookie_val=None):
        self.playlist_url = playlist_url
        self.cookie_val = cookie_val
        if playlist_url:
            self.html_src = self.retrieve_html_source()

    # Downloads the playlist page using provided cookie
    def retrieve_html_source(self):
        assert self.playlist_url is not None
        driver = webdriver.Firefox()
        driver.set_window_size(500, 2000)
        cookie = {
            'name': 'sps',
            'value': self.cookie_val,
            'secure': True,
            'domain': '.spotify.com',
            'path': '/'
        }
        driver.get(self.playlist_url)
        time.sleep(6)
        playlist_id = self.playlist_url.split('/')[-1]
        driver.refresh()
        driver.add_cookie(cookie)
        driver.refresh()
        driver.set_window_size(500, 2000)
        time.sleep(6)
        driver.set_window_size(500, 2000)

        try:
            # Finding the iframe id
            regex = r'<iframe id="(browse-app-spotify:app:user:.*playlist:' + re.escape(playlist_id) + r'.*)".*src=".*?"'
            iframe_id = re.findall(regex, driver.page_source)[0]
            iframe = driver.find_element_by_id(iframe_id)

            # Switch to the iframe context
            driver.switch_to.default_content()
            driver.switch_to.frame(iframe)

            # Get the html code from the iframe
            html_src = driver.page_source
            driver.close()

        except IndexError:
            # If the iframe could not be found, then an invalid cookie was likely provided
            driver.close()
            raise InvalidCookieException

        return html_src

    def get_playlist(self):
        # Retrieve HTML source if it has not been retrieved already
        if not self.html_src:
            source = self.retrieve_html_source()
        else:
            source = self.html_src

        #split to find the playlist name
        name_source = source.split("<h1 class=\"main\">")[1]
        name_source = name_source.split("</span>")[0]
        playlist_name = re.findall(r'\">(.*)</a>', name_source)[0]

        # Remove everything before the playlist section
        songs_source = source.split("<tbody data-bind=\"foreach: tracks\"")[1]
        # Divide up into songs
        songs = songs_source.split("</tr>")

        # Create a array of dictionaries of all the songs
        songs_dict = []
        for song in songs:
            try:
                song_dict = {
                    'title': re.findall(r'<td.*>(.*)<\/div>', song, re.S)[0],
                    'artist': re.findall(r'spotify:artist:.*>(.*)<\/a>', song)[0],
                    'album': re.findall(r'spotify:album.*>(.*)<\/a>', song)[0],
                    'time': Util.time_in_seconds(re.findall(r'tl-time\">([\w|:]*)<\/td>', song, re.S)[0]),
                }
                songs_dict.append(song_dict)
            except IndexError:
                pass

        return [playlist_name, songs_dict]

    @staticmethod
    def get_cookie():
        try:
            with open(".cookie", "r") as file:
                cookie_val = file.read()

            return cookie_val
        except FileNotFoundError:
            cookie_val = str(input("Please enter your cookie: "))
            with open(".cookie", "w") as file:
                file.write(cookie_val)


