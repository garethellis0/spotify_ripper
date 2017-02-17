from src.Controller import Controller
from src.YouTubeDownloader import YouTubeDownloader

print("=== Welcome to Spotify Ripper ===")

while True:
    print("\nWhat would you like to do?")
    user_input = str(input("d - Download playlists from Spotify (by URL)\n" +
                           "u - Update previously downloaded playlists\n" +
                           "c - Enter individual songs to download\n" +
                           "r - Try to re-download failed songs\n" +
                           "q - Quit the program\n\n"))

    if user_input == "d":
        Controller.download_playlists()
    elif user_input == "u":
        print("update previously downloaded playlists")
    elif user_input == "c":
        print("enter individual songs")
    elif user_input == "r":
        print("redownload failed songs")
    elif user_input == "q":
        print("quit program")
        break
    else:
        # invalid input
        print("ERROR: INVALID INPUT\n")

print("Quitting Spotify Ripper.....\n")