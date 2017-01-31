import unittest

from legacy.MP3Downloader import MP3Downloader


class TestMP3DownloaderAPI(unittest.TestCase):
    def test_get_downloads_valid(self):
        print("\n===== Testing get_downloads() =====")
        mdl = MP3Downloader(self.get_test_downloads_dictionary())
        mdl.get_downloads()

    def test_remove_invalid_chars(self):
        print("\n===== Testing remove_invalid_chars() =====")
        song = {
            "Title": "Dirty Deeds Done Dirt Cheap",
            "Artist": "AC/DC",
            "Album": "Blow Up Your Video"
        }

        mdl = MP3Downloader([song])
        new_name = mdl._remove_invalid_chars(song["Title"])
        new_artist = mdl._remove_invalid_chars(song["Artist"])
        expected_new_name = "Dirty Deeds Done Dirt Cheap"
        expected_new_artist = "AC_DC"
        print("Test result: %s    Expected result %s" % (new_name, expected_new_name))
        print("Test result: %s    Expected result %s" % (new_artist, expected_new_artist))
        self.assertEqual(new_name, expected_new_name)
        self.assertEqual(new_artist, expected_new_artist)
        mdl.get_downloads()

    def test_vid_evaluation_valid(self):
        print("\n===== Testing vid_eval =====")
        mdl = MP3Downloader(self.get_test_downloads_dictionary())
        song = {
            'Title': "Bang Bang",
            'Artist': "Green Day",
            'Album': "test_album"
        }

        vid_list = [

            {
                'title': "Green Day - Bang Bang (Official Music Video)",
                'url': "bad1"
            },

            {
                'title': "Green Day - Bang Bang (Video Shoot Behind The Scenes)",
                'url': "bad2"
            },

            {
                'title': "Green Day Bang Bang (Full Band Cover by Minority 905)",
                'url': "bad3"
            },

            {
                'title': "Green Day - Bang Bang Drum cover",
                'url': "bad4"
            },

            {
                'title': "BANG BANG by Green Day (Acoustic Cover)",
                'url': "bad5"
            },

            {
                'title': "Reaction to \"Bang Bang\" NEW GREEN DAY!",
                'url': "bad6"
            },

            {
                'title': "Green Day - Bang Bang (Official Lyric Video)",
                'url': "good1"
            },

            {
                'title': "Green Day - Bang Bang lyrics",
                'url': "good2"
            },
        ]

        test_result = mdl._get_best_song_url(song, vid_list)
        expected_result = "good1"
        print("Test result: %s    Expected result: %s" % (test_result, expected_result))
        self.assertEqual(test_result, expected_result)

    def test_vid_evaluation_valid_2(self):
        print("\n===== Testing vid_eval_2 =====")
        mdl = MP3Downloader(self.get_test_downloads_dictionary())
        song = {
            "Title": "Alive",
            "Artist": "Pearl Jam",
            "Album": "test album"
        }

        vid_list = [

            {
                'title': "Pearl Jam - Alive Live Concert",
                'url': "bad1"
            },

            {
                'title': "Pearl Jam Alive Acoustic Cover",
                'url': "bad2"
            },

            {
                'title': "Pearl Jam Live at Sidney 2012",
                'url': "bad3"
            },

            {
                'title': "Pearl_Jam || Alive instrumental",
                'url': "bad4"
            },

            {
                'title': "Pearl Jam - Alive (Lyrics)",
                'url': "good"
            },
        ]

        test_result = mdl._get_best_song_url(song, vid_list)
        expected_result = "good"
        print("Test result: %s    Expected result: %s" % (test_result, expected_result))
        self.assertEqual(test_result, expected_result)

    def test_vid_evaluation_invalid(self):
        print("\n===== Testing vid_eval_invalid =====")
        mdl = MP3Downloader(self.get_test_downloads_dictionary())
        song = {
            'Title': "Bang Bang",
            'Artist': "Green Day",
            'Album': "test album"
        }

        vid_list = [

            {
                'title': "Green Day - Bang Bang (Official Music Video)",
                'url': "bad1"
            },

            {
                'title': "Green Day - Bang Bang (Video Shoot Behind The Scenes)",
                'url': "bad2"
            },

            {
                'title': "Green Day Bang Bang (Full Band Cover by Minority 905)",
                'url': "bad3"
            },

            {
                'title': "Green Day - Bang Bang Drum cover",
                'url': "bad4"
            },

            {
                'title': "BANG BANG by Green Day (Acoustic Cover)",
                'url': "bad5"
            },

            {
                'title': "Reaction to \"Bang Bang\" NEW GREEN DAY!",
                'url': "bad6"
            },
        ]

        test_result = mdl._get_best_song_url(song, vid_list)
        expected_result = ""
        print("Test result: \"%s\"    Expected result: \"%s\" (emtpy string)" % (test_result, expected_result))
        self.assertEqual(test_result, expected_result)

    def get_test_downloads_dictionary(self):
        songs = [
            {
                "Title": "Life Itself",
                "Artist": "Glass Animals",
                "Album": "Life Itself",
                "Time": "04:40",
                "URL": "https://www.youtube.com/watch?v=N3bklUMHepU"
            },

            {
                "Title": "Disarm",
                "Artist": "The Smashing Pumpkins",
                "Album": "test_album"
            },

            {
                "Title": "American Money",
                "Artist": "BØRNS",
                "Album": "Test",
                "Time": "4:20",
                "URL": "https://www.youtube.com/watch?v=ABFz2Qag6Dw"
            },

            {
                "Title": "Get Right",
                "Artist": "Jimmy Eat World",
                "Album": "Get Right",
                "Time": "02:49",
                "URL": "https://www.youtube.com/watch?v=vMj7baqFV3M"

            },

            {
                "Title": "Bang Bang",
                "Artist": "Green Day",
                "Album": "Bang Bang",
                "Time": "03:25",
                "URL": "https://www.youtube.com/watch?v=mg5Bp_Gzs0s"
            },

            {
                "Title": "Hardwired",
                "Artist": "Metallica",
                "Album": "Hardwired",
                "Time": "03:11",
                "URL": "https://www.youtube.com/watch?v=Rqnl1Z9okE4"
            },

            {
                "Title": "Wake Up Call",
                "Artist": "Nothing but Thieves",
                "Album": "Nothing But Thieves (Deluxe)",
                "Time": "02:45",
                "URL": "https://www.youtube.com/watch?v=8phg58HrQek"
            },

            {
                "Title": "Rock Lobster",
                "Artist": "The B-52's",
                "Album": "The B-52's",
                "Time": "6:49",
                "URL": "https://www.youtube.com/watch?v=tG6Be3KtOZg"
            },

            {
                "Title": "Just Can't Get Enough",
                "Artist": "Depeche Mode",
                "Album": "Catching Up With Depeche Mode",
                "Time": "3:25",
                "URL": "https://www.youtube.com/watch?v=34s_cIuHWB4"
            },

            {
                "Title": "Red Flag",
                "Artist": "The Moth & The Flame",
                "Album": "test",
                "Time": "4:20",
                "URL": "https://www.youtube.com/watch?v=bqDrftAxYpk"
            },

            {
                "Title": "Women",
                "Artist": "Def Leppard",
                "Album": "Hysteria",
                "Time": "6:11",
                "URL": "https://www.youtube.com/watch?v=dSZ2Q3cKepU"
            },

            {
                "Title": "Camilla",
                "Artist": "Basshunter",
                "Album": "Bass Generation",
                "Time": "3:23",
                "URL": "https://www.youtube.com/watch?v=4__Cq-DeB5U"
            },

            {
                "Title": "Goodbye Forever",
                "Artist": "Volbeat",
                "Album": "Seal The Deal & Let's Boogie",
                "Time": "4:31",
                "URL": "https://www.youtube.com/watch?v=WEElfat8H-I"
            },

            {
                "Title": "Coffee Girl",
                "Artist": "The Tragically Hip",
                "Album": "We Are The Same",
                "Time": "3:46",
                "URL": "https://www.youtube.com/watch?v=A_7nPkjdLQY"
            },

            {
                'Title': 'The Middle',
                'Artist': 'Jimmy eat World',
                "Album": 'test'
            },

            {
                'Title': 'Welcome to the Jungle',
                'Artist': 'Guns \'n\' Roses',
                'Album': 'Test'
            },

            {
                'Title': 'Jane Says',
                'Artist': 'Jane\'s Addiction',
                'Album': 'Test'
            }
        ]

        return songs


if __name__ == '__main__':
    unittest.main()
