import re

class Util:
    @staticmethod
    def html_to_ascii(s):
        """
        Converts html encoding to ascii in a String and returns a new String

        :param s: A String
        :return: A new String replacing all html encoding with ascii representation
        """
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

    # Removes character that cannot be included in a filename, replaces them with spaces
    # and returns the new String
    @staticmethod
    def remove_invalid_filename_chars(s):
        """
        Takes a String and removes any characters that are invalid filename characters

        :param s: A String
        :return: A String with any invalid filename characters removed
        """
        invalid_chars = [["/", "_"]]
        for char in invalid_chars:
            s = s.replace(char[0], char[1])

        return s

    @staticmethod
    def get_song_filename(artist, title):
        """
        Returns a String representing the file name of a song with artist and title

        :param artist: The artist of the song. Must not be None or empty
        :param title:  The title of the song. Must not be None or empty
        :return: A String representing the filename of the song
        """
        return artist + " - " + title

    @staticmethod
    def get_best_song_url(song, song_search_info):
        """
        Takes a list of dictionaries, containing song serach 'title' and 'url', and return the url
        for the best song

        :param song: A dictionary containing the song info. Must include 'title', 'artist', album', and 'time' fields.
        :param song_search_info: A list of dictionaries containing the info for a search for that song.
                                 Must contain 'title' and 'url' fields.
        :return:
        """
        # TODO: fix this - clean up? and check that name exists in title. remove remix, mix
        for search_result in song_search_info:
            song_title_and_artist = song['Title'] + " " + song['Artist']
            vid_title = search_result["title"]
            url = search_result["url"]

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
            # If the video is an acoustic version
            elif re.search(r"(?<![a-z])acoustic(?![a-z])", vid_title, re.IGNORECASE) is not None \
                    and re.search("(?<![a-z])acoustic(?![a-z])", song_title_and_artist, re.IGNORECASE) is None:
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

    # TODO: implement this
    def rename_song_file(self, filepath):
        return

    # TODO: implement this
    def write_metadata(self):
        return