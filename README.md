# Onesend

send your file through onedrive

## Features

-   Upload file without login, share anytime!
-   End-to-end encryption, security matters!
-   Onedrive storage, **No** traffic passthrough, free your server!
-   CLI command generation, easy for linux command-line download!

## Demo

<https://send.luang.co>

## How does it work

1. Open the website
1. Upload your file(s)
1. Get the link and share it
1. Others download from the link

## Limitations

-   **MUST** hosted on https site (because service worker only works on https)
-   Cannot work in Firefox InPrivate window (because service worker are disabled)
-   Leaving downloading page will interrupt downloading (because downloading is done inside service worker)

## Deploy

1. download from release and unzip
1. run program

## Configuration

**SavePath**: where to save files in your onedrive  
**Listen**: how the program bind address

if you want to use your private client_id and client_secret to setup this app, you can check [This Instruction](./docs/Private-App.md)

## Build

If you want to build from source, you need to install [go](https://golang.org/) and run `go build` in the project directory
