import unittest

from src.Util import Util

class UtilTest(unittest.TestCase):
    def test_remove_invalid_chars(self):
        self.assertEqual("abc123", Util._remove_invalid_chars("abc123"))
        self.assertEqual("~`!@#$%^&*()_+-=", Util._remove_invalid_chars("~`!@#$%^&*()_+-="))
        self.assertEqual("'", Util._remove_invalid_chars("'"))
        self.assertEqual('"', Util._remove_invalid_chars('"'))
        self.assertEqual("[]{};:<>,.?", Util._remove_invalid_chars("[]{};:<>,.?"))
        self.assertEqual("ac/dc", Util._remove_invalid_chars("ac_dc"))
        self.assertEqual("/////", Util._remove_invalid_chars("_____"))
        self.assertEqual("", Util._remove_invalid_chars(""))
        self.assertEqual("tes#tT/ex\/t", Util._remove_invalid_chars("tes#tT/ex_/t"))
        self.assertEqual("/This is a (sp3ci@l:/) test//", Util._remove_invalid_chars("_This is a (sp3ci@l:_) test__"))

    def test_html_to_ascii(self):
        self.assertEqual("abc123", Util._html_to_ascii("abc123"))

if __name__ == '__main__':
    unittest.main()