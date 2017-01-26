import re
import time
from selenium import webdriver


class InvalidCookieException(Exception):
    pass


class SpotifyScraperAPI:
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
        time.sleep(5)
        playlist_id = self.playlist_url.split('/')[-1]
        driver.refresh()
        driver.add_cookie(cookie)
        driver.refresh()
        driver.set_window_size(500, 2000)
        time.sleep(5)
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

        # Remove everything before the playlist section
        source = source.split("<tbody data-bind=\"foreach: tracks\"")[1]
        # Divide up into songs
        songs = source.split("</tr>")

        # Create a array of dictionaries of all the songs
        songs_dict = []
        for song in songs:
            try:
                song_dict = {
                    'Title': re.findall(r'<td.*>(.*)<\/div>', song, re.S)[0],
                    'Artist': re.findall(r'spotify:artist:.*>(.*)<\/a>', song)[0],
                    'Album': re.findall(r'spotify:album.*>(.*)<\/a>', song)[0],
                    'Time': re.findall(r'tl-time\">([\w|:]*)<\/td>', song, re.S)[0],
                }
                songs_dict.append(song_dict)
            except IndexError:
                pass

        return songs_dict


