# Spotify Ripper
Uses Youtube to download Spotify-inspired playlists as mp3 files. The songs are saved in a /music folder in the project directory. All songs are renamed in the form "Artist - Title", and have their metadata updated accordingly.

##How It Works
1. Takes in the url of a spotify playlist, for example <https://play.spotify.com/user/spotify_canada/playlist/7AbqmyXn8eDLIJ4Hi9033A>, and the browser cookie representing the user's spotify credentials.
2. Using the web source of the given playlist, creates a dictionary of songs that includedes their Title, Artist, Album, and Time.
3. The program then creates URLs representing the youtube search results for each song in the dictionary. URLs are created as if the search was in the form "Artist Title lyrics". These search URLs are appended to each song in the dictionary.
4. Using the web source for each of these search URLs, the URLs for the top search result are created and appended to the dictionary as well
5. These URLs are then used to download the mp3 files from each of the songs.
6. The downloaded files are then renamed to the format "Artist - Title"
7. Finally, the Title, Artist, and Album metadata for each song is written as well.

The user will end up with the mp3 files corresponding to each song in the spotify playlist in a /music folder in the project directory.

## Note:
    - Requires the user to have a Spotify account
    - May not handle playlists over 400 songs in length
