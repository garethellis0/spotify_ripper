import os
from MP3Downloader import MP3Downloader
from SpotifyScraperAPI import SpotifyScraperAPI, InvalidCookieException


# # Get the Playlist to download
# playlist_url = str(input("Please enter the url of the playlist you wish to download: "))
#
# # Check if there is a cookie cached, get it from the user and cache it otherwise
# try:
#     open(".cookie")
#     cookie_val = str(open(".cookie").read())
# except FileNotFoundError:
#     cookie_val = str(input("Please enter your cookie: "))
#     cookie_cache = open(".cookie", 'w+')
#     cookie_cache.write(cookie_val)
#
# # cookie_val = "4aeb49139e71f1c91b82734e78196b26ad536015wQqZgfGWpX4NEGEOghGpd630ova8bzedEDZ8dfWlGkEdonL%2BT4vFsXDEKtcozD5CBJyBd5qSYBjs%2FRhDS7I7b%2FD0l70FfapB%2B1H73NWdYn3ON8%2BJ5lgXk8Y89DT3Ha8MMwFQku1ZkcNflUJh0JHwMT2Ns3sN1qemSNH0vIfymQ2FTFVRpOmGGyUiKCSiRTJUKVcwLljHBu%2BcdMx5OwNY3iBVsoZXyfUuk%2BmpQAujMGvVRoYUYl7BN23KJFkJ%2FwA3Vpw6Tlz1czoIxdxKsANuiD5%2BGR8pttSB0DnOZe3iioSzFC4ZRzV3YKUoY2%2Bjir05"
# # playlist_url = "https://play.spotify.com/user/spotify/playlist/0lbtgFu3JNKX77J5YOpW7n"

# spotify_scraper_api = SpotifyScraperAPI(playlist_url, cookie_val)
# songs = spotify_scraper_api.get_playlist()
# mp3_downloader = MP3Downloader()
# mp3_downloader.get_downloads(songs)

url_correct = "n"
while True:
    # Check if there is a cookie cached, get it from the user and cache it otherwise
    if url_correct != "y":
        playlist_url = str(input("Please enter the url of the playlist you wish to download: "))
    try:
        cookie_val = str(open(".cookie").read())
    except FileNotFoundError:
        cookie_val = str(input("Please enter your cookie: "))
        cookie_cache = open(".cookie", 'w+')
        cookie_cache.write(cookie_val)

    try:
        spotify_scraper_api = SpotifyScraperAPI(playlist_url, cookie_val)
        songs = spotify_scraper_api.get_playlist()
        print("Successfully retrieved playlist, downloading songs from youtube")
        mp3_downloader = MP3Downloader()
        mp3_downloader.get_downloads(songs)
        break
    except InvalidCookieException:
        # Ask the user to double check the url
        url_correct = str(input("Was that url correct? (Will ask for new cookie if yes) (y/n): "))
        if url_correct is "y":
            os.remove(".cookie")
