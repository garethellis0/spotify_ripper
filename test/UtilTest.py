import unittest

from src.Util import Util

class UtilTest(unittest.TestCase):
    def test_remove_invalid_chars(self):
        self.assertEqual("abc123", Util.remove_invalid_filename_chars("abc123"))
        self.assertEqual("~`!@#$%^&*()_+-=", Util.remove_invalid_filename_chars("~`!@#$%^&*()_+-="))
        self.assertEqual("'", Util.remove_invalid_filename_chars("'"))
        self.assertEqual('"', Util.remove_invalid_filename_chars('"'))
        self.assertEqual("[]{};:<>,.?", Util.remove_invalid_filename_chars("[]{};:<>,.?"))
        self.assertEqual("ac_dc", Util.remove_invalid_filename_chars("ac/dc"))
        self.assertEqual("_____", Util.remove_invalid_filename_chars("/////"))
        self.assertEqual("", Util.remove_invalid_filename_chars(""))
        self.assertEqual("tes#tT_ex\_t", Util.remove_invalid_filename_chars("tes#tT/ex\/t"))
        self.assertEqual("_This is a (sp3ci@l:_) test__", Util.remove_invalid_filename_chars("/This is a (sp3ci@l:/) test//"))

    def test_html_to_ascii(self):
        self.assertEqual("abc123", Util.html_to_ascii("abc123"))
        self.assertEqual("-1,.v0s=_`<>mbak;';'", Util.html_to_ascii("-1,.v0s=_`<>mbak;';'"))
        self.assertEqual("You & I - The Hunna", Util.html_to_ascii("You &amp; I - The Hunna"))
        self.assertEqual("\"My dog is named 'Dog'\"", Util.html_to_ascii("&quot;My dog is named &#39;Dog&#39;&quot;"))
        self.assertEqual("Duck goes <Quack!>", Util.html_to_ascii("Duck goes &lt;Quack!&gt;"))
        self.assertEqual("1 && two", Util.html_to_ascii("1 &&amp; two"))
        self.assertEqual("\"\"Double double quote\"\"", Util.html_to_ascii("&quot;&quot;Double double quote&quot;&quot;"))

    def test_get_song_filename(self):
        self.assertEqual("Billy Talent - Rusted From the Rain", Util.get_song_filename("Billy Talent", "Rusted From the Rain"))
        self.assertEqual("The Hunna - You & I", Util.get_song_filename("The Hunna", "You & I"))
        self.assertEqual("Beck - Wow", Util.get_song_filename("Beck", "Wow"))


if __name__ == '__main__':
    unittest.main()