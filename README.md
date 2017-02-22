# Spotify Ripper
A python script that uses YouTube and other alternative sources to imitate and download Spotify's playlists

## Requires
* Firefox version 47.0.2 or older
* A Spotify account (does not need to be premium)
* Python 3
* ffmpeg (<https://ffmpeg.org/>)
* Everything else from the setup script (setup.py)

## Usage
1. Make sure you have run setup.py (sudo python3 setup.py install)
2. Running run.py will present you with a list of options
    1. Download Spotify playlists by URL
        * The user will be promted for the URLs of Spotify playlists. More than 1 may be entered
        * Each playlist will be downloaded into a seperate folder
    2. Update previously downloaded playlists
        * All playlists that are downloaded are remembered, and this option will re-run all those playlists and update the songs in their directories
    3. Enter individual songs to download
        * The user will be promted to enter the information for individual songs, which will then be downloaded. Multiple songs may be entered. __If the information entered is incorrect it will not work. Beware of typos__
    4. Re-download failed songs
        * Sometimes Spotify-ripper can't find a song to download. It remembers these songs, and this option will attempt to find and download these songs again. They will be places in the original playlist directory they were intended for
    5. Quit the program
        * Quits the program (obviously)
        
* The songs are downloaded in the highest qualitymp3 format available
* Songs that are downloaded are renamed to the format "artist - title".mp3, have their audio normalized, and have their metadata written
* __Firefox windows will open and close while Spotify-ripper gets information from Spotify. Do not close or resize these windows while the script is running. They should close automatically__

### Notes
* May not handle playlists over 400 songs in length
* Sometimes websites will not load properly on their first try, and need to be re-run
