#!/usr/bin/env python

from setuptools import setup

setup(name='Spotify Ripper',
      version='2.0',
      description='Utility for downloading Spotify playlists',
      author='Mathew MacDougall and Gareth Ellis',
      install_requires=['youtube_dl', 'selenium', 'pytag', 'workerpool'],
     )
