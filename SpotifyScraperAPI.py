import os
import re

class SpotifyScraperAPI:
    def __init__(self, playlist_page_folder):
        self.playlist_page_folder = playlist_page_folder
        self.playlist_page = self.find_playlist_file()

    # Figures out which file in the folder of html resources
    # contains the playlist information
    def find_playlist_file(self):
        curr_dir = os.path.dirname(__file__)
        playlist_page_dir = curr_dir + "/" + self.playlist_page_folder

        # Check to make sure that the given folder actually exists
        if not os.path.isdir(curr_dir + "/" + self.playlist_page_folder):
            raise OSError("Given playlist folder does not exist")

        # Find the file that contains the playlist
        for filename in os.listdir(playlist_page_dir):
            full_file_path = playlist_page_dir + "/" + filename
            file = open(full_file_path, encoding="latin-1")
            text = file.read()
            file.close()
            if len(re.findall(r'tbody\sdata', text)) >= 1:
                return full_file_path

        raise Exception("Could not find playlist file")

    def get_playlist(self):
        # Take in the file containing the playlist
        file = open(self.playlist_page, encoding="latin-1")
        source = file.read()
        file.close()

        # Remove everything before the playlist section
        source = source.split("<tbody data-list-items=\"true\" data-scroll-container=\"\" data-bind=\"foreach: tracks\">")[1]
        # Remove everything after the playlist section
        source = source.split("</tbody>")[0]
        # Divide up into songs
        songs = source.split("</tr>")

        # Create a array of dictionaries of all the songs
        songs_dict = []
        for song in songs:
            try:
                song_dict = {
                    'Title': re.findall(r'<td.*>(.*)</div>', song, re.S)[0],
                    'Artist': re.findall(r'spotify:artist:\w*">(.*)</a>', song)[0],
                    'Album': re.findall(r'spotify:album:\w*">(.*)</a>', song)[0],
                    'Time': re.findall(r'duration">(.*)</td>', song)[0],
                }
                songs_dict.append(song_dict)
            except IndexError:
                pass

        return songs_dict



