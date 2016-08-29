from MP3Downloader import MP3Downloader
from SpotifyScraperAPI import SpotifyScraperAPI

spotify_scraper_api = SpotifyScraperAPI('test/test_files')
songs = spotify_scraper_api.get_playlist()
mp3_downloader = MP3Downloader()
mp3_downloader.get_downloads(songs)
