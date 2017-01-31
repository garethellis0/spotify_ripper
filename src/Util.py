import re

class Util:
    # Returns the ASCII decoded version of given HTML string
    @staticmethod
    def html_to_ascii(self, s):
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
    def remove_invalid_filename_chars(self, s):
        invalid_chars = [["/", "_"]]
        for char in invalid_chars:
            s = s.replace(char[0], char[1])

        return s

    @staticmethod
    def get_song_filename(self, title, artist):
        return

    @staticmethod
    #
    # Given a list of vid info (video title and url) for a song, returns the first song in
    # the list that is not a cover, music video, live performance, reaction video, behind the scenes, acoustic version, or instrumental.
    # Returns the url of the best video, and returns and empty string if no video meets the criteria
    def get_best_song_url(self, song, vid_info):
        # TODO: fix this
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
