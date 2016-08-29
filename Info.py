from __future__ import unicode_literals
import youtube_dl
import urllib.request
import re



class Ripper:

    song1 = {
        "Title": "Life Itself",
        "Artist": "Glass Animals",
        "Album": "Life Itself",
        "Time": "04:40"
    }

    song2 = {
        "Title": "Get Right",
        "Artist": "Jimmy Eat World",
        "Album": "Get Right",
        "Time": "02:49"
    }

    song3 = {
        "Title": "Bang Bang",
        "Artist": "Green Day",
        "Album": "Bang Bang",
        "Time": "03:25"
    }

    song4 = {
        "Title": "Hardwired",
        "Artist": "Metallica",
        "Album": "Hardwired",
        "Time": "03:11"
    }

    song5 = {
        "Title": "Wake Up Call",
        "Artist": "Nothing but Thieves",
        "Album": "Nothing But Thieves (Deluze)",
        "Time": "02:45"
    }

    songs = [song1, song2, song3, song4, song5]
    #youtube url search template:  https://www.youtube.com/results?search_query=green+day+bang+bang

    #returns a list of urls corresponding to youtube searches for the songs listed in songs
    #songs - must be an array of dictionaries containing "Artist" and "Title"
    def get_search_urls(songs):
        url_start = "https://www.youtube.com/results?search_query="
        urls = []

        for song in range(len(songs)):
            url = url_start + songs[song]["Artist"] + "+" + songs[song]["Title"] + "+" + "lyrics"
            url = url.replace(" ", "+")
            url = url.lower()
            urls.append(url)
            #print(url)
        return urls

    # https://www.youtube.com/watch?v=mg5Bp_Gzs0s
    # https://www.youtube.com/watch?v=N3bklUMHepU
    # https://www.youtube.com/watch?v=vMj7baqFV3M
    # https://www.youtube.com/watch?v=8phg58HrQek

    # print (len("Rqnl1Z9okE4")) #  metallica, hard-wired
    # print (len("mg5Bp_Gzs0s")) # Green day, bang bang
    # print (len("N3bklUMHepU")) # glass animal, life itself
    # print (len("vMj7baqFV3M")) # jimmy eat world, get right
    # print (len("8phg58HrQek")) # nothing buyt thieves, wake up call
    # print (len("ZN0pqkKhf1o")) #random vid


    #testing dowloading page source from url
    def get_song_urls(searches):
        song_urls = []
        url_beginning = "https://www.youtube.com"

        for url in range(len(searches)):
            url = searches[url]
            with urllib.request.urlopen(url) as response:
                html = response.read()

            source = html.decode("utf-8")
            # print (source)

            pattern = re.compile("href=\"\/watch\?v=...........")
            url_termination = re.search(pattern, source)
            url_termination = url_termination.group(0)
            url_termination = url_termination[6:]
            song_url = url_beginning + url_termination
            song_urls.append(song_url)

        return song_urls


    def download_songs(urls):
        for url in urls:
            ydl_opts = {
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
            }
            with youtube_dl.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

    #test code
    search_urls = get_search_urls(songs)
    print(search_urls)
    song_urls = get_song_urls(search_urls)
    print (song_urls)
    download_songs(song_urls)