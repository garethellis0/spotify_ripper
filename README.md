# Spotify Ripper
Uses Youtube to download Spotify-inspired playlists as mp3 files. The songs are saved in a /music folder in the project directory. All songs are renamed in the form "Artist - Title", and have their metadata updated accordingly.

##How It Works
1. Takes in the url of a spotify playlist, for example <https://play.spotify.com/user/spotify_canada/playlist/7AbqmyXn8eDLIJ4Hi9033A>, and the browser cookie representing the user's spotify credentials.
2. Using the web source of the given playlist, creates a list of dictionaries. Each dictionary contains the information for one song, and includes their Title, Artist, Album, and Time. A Firefox window will open and close during this operation. Closing it preemptively will prevent the information from being gathered.
3. The program then creates URLs representing the youtube search results for each song in the dictionary. URLs are created as if the search was in the form "Artist Title lyrics". These search URLs are appended to the dictionary for that song.
4. Using the web source for each of these search URLs, the search results are evaluated and the URL of the best video is appended to the dictionary. In this case, the best video means it is not a music video, a cover, a live performance, an instrumental, a behind the scences video, or a rection video. Songs without a suitable video are skipped.
5. These song URLs are then used to download the mp3 files from each of the songs.
6. The downloaded files are renamed to the format "Artist - Title"
7. Finally, the Title, Artist, and Album metadata for each song is written as well.

The user will end up with the mp3 files corresponding to each song in the spotify playlist in a /music folder in the project directory.

## Note:
    - Requires the user to have a Spotify account (must not be Premium)
    - Currently requires version 47.0.2 of Firefox or lower
    - May not handle playlists over 400 songs in length
