# Privacy policy

Game Log Tracker DS Launcher ("the launcher") is an Android app for tracking and launching your games. This page explains what it does with your information.

## What stays on your device

Your library, backlog, playtime, settings, logins and API keys are stored on your device. The launcher has no accounts of its own and no server that collects your data.

## Cloud sync (optional)

If you turn on Cloud sync and sign in with Google, the launcher saves a copy of your launcher data in a hidden app folder in **your own Google Drive**. It asks Google only for the `drive.appdata` permission, so:

- it can only see the files it created in that hidden folder, not any of your other Drive files
- the copy goes straight between your device and your Google account and is never sent to the developer
- your logins and API keys are never included

You can turn Cloud sync off at any time in Data Options, and choose to delete the cloud copy when you do. You can also remove the launcher's access from your Google Account settings under Security → Third-party apps and services.

## Services the launcher contacts

To look up games, achievements and pictures, the launcher contacts:

- RetroAchievements, using the username and Web API key you enter
- IGDB and ScreenScraper, through the developer's Cloudflare proxy, which passes the requests on to them
- LaunchBox Games Database and SteamGridDB, for game art
- GitHub, for the list of Android ports

These requests contain what is needed for the lookup, such as a game's name or ID. Each service has its own privacy policy.

## Usage count

Release builds send one anonymous ping per day to GoatCounter when the launcher is opened, to count how many people use it. It contains no personal information and no device ID.

## Contact

Questions can be asked through the GitHub repository's [Issues](https://github.com/Gin649/Game-Log-Tracker-DS-Launcher/issues).
