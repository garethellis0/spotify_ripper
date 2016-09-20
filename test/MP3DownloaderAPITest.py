import unittest
from MP3Downloader import MP3Downloader
import youtube_dl

dl = youtube_dl.FileDownloader


class TestMP3DownloaderAPI(unittest.TestCase):

    def test_get_downloads_valid(self):
        test_dictionary = self.get_test_dictionary()
        mdl = MP3Downloader(test_dictionary)
        mdl.get_downloads()

    def test_get_urls_invalid(self):
        pass

    #Test dictionary includes URLs for testing
    def get_test_dictionary(self):
        songs = [
            # {
            #     "Title": "Life Itself",
            #     "Artist": "Glass Animals",
            #     "Album": "Life Itself",
            #     "Time": "04:40",
            #     "URL": "https://www.youtube.com/watch?v=N3bklUMHepU"
            # },
            #
            # {
            #     "Title": "American Money",
            #     "Artist": "BØRNS",
            #     "Album": "Test",
            #     "Time": "4:20",
            #     "URL": "https://www.youtube.com/watch?v=ABFz2Qag6Dw"
            # },
            #
            #
            # {
            #     "Title": "Get Right",
            #     "Artist": "Jimmy Eat World",
            #     "Album": "Get Right",
            #     "Time": "02:49",
            #     "URL": "https://www.youtube.com/watch?v=vMj7baqFV3M"
            #
            # },
            #
            {
                "Title": "Bang Bang",
                "Artist": "Green Day",
                "Album": "Bang Bang",
                "Time": "03:25",
                "URL": "https://www.youtube.com/watch?v=mg5Bp_Gzs0s"
            },
            #
            # {
            #     "Title": "Hardwired",
            #     "Artist": "Metallica",
            #     "Album": "Hardwired",
            #     "Time": "03:11",
            #     "URL": "https://www.youtube.com/watch?v=Rqnl1Z9okE4"
            # },
            #
            # {
            #     "Title": "Wake Up Call",
            #     "Artist": "Nothing but Thieves",
            #     "Album": "Nothing But Thieves (Deluxe)",
            #     "Time": "02:45",
            #     "URL": "https://www.youtube.com/watch?v=8phg58HrQek"
            # },
            #
            # {
            #     "Title": "Rock Lobster",
            #     "Artist": "The B-52's",
            #     "Album": "The B-52's",
            #     "Time": "6:49",
            #     "URL": "https://www.youtube.com/watch?v=tG6Be3KtOZg"
            # },
            #
            # {
            #     "Title": "Just Can't Get Enough",
            #     "Artist": "Depeche Mode",
            #     "Album": "Catching Up With Depeche Mode",
            #     "Time": "3:25",
            #     "URL": "https://www.youtube.com/watch?v=34s_cIuHWB4"
            # },
            #
            # {
            #     "Title": "Red Flag",
            #     "Artist": "The Moth & The Flame",
            #     "Album": "test",
            #     "Time": "4:20",
            #     "URL": "https://www.youtube.com/watch?v=bqDrftAxYpk"
            # },
            #
            # {
            #     "Title": "Women",
            #     "Artist": "Def Leppard",
            #     "Album": "Hysteria",
            #     "Time": "6:11",
            #     "URL": "https://www.youtube.com/watch?v=dSZ2Q3cKepU"
            # },
            #
            # {
            #     "Title": "Camilla",
            #     "Artist": "Basshunter",
            #     "Album": "Bass Generation",
            #     "Time": "3:23",
            #     "URL": "https://www.youtube.com/watch?v=4__Cq-DeB5U"
            # },
            #
            # {
            #     "Title": "Goodbye Forever",
            #     "Artist": "Volbeat",
            #     "Album": "Seal The Deal & Let's Boogie",
            #     "Time": "4:31",
            #     "URL": "https://www.youtube.com/watch?v=WEElfat8H-I"
            # },
            #
            # {
            #     "Title": "Coffee Girl",
            #     "Artist": "The Tragically Hip",
            #     "Album": "We Are The Same",
            #     "Time": "3:46",
            #     "URL": "https://www.youtube.com/watch?v=A_7nPkjdLQY"
            # }


        ]

        return songs

    def get_expected_urls(self, test_dict):
        expected_urls = []
        for song in test_dict:
            expected_urls.append(song["URL"])

        return expected_urls


if __name__ == '__main__':
    unittest.main()
