# Onesend

send your file through onedrive

## Demo

<https://send.yuudi.xyz>

## Usage

1. download from release and unzip
2. fill in *config.toml*
3. fill your refresh token into *token.txt* (you can refer to [Authorization](#Authorization))
4. run program

## Configuration

**ClientID**: client id  
**ClientSecret**: client secret  
**AccountArea**: the area of your onedrive account, can be ("global" | "gov" | "de" | "cn")  
**Drive**: the drive path to use. default: "/me/drive"  
**SavePath**: where to save files in your onedrive  
**Listen**: how the program bind address  

## Authorization

1. Open <https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade> and then click `New registration`.
1. Enter a name for your app, choose account type `Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)`, select `Web` in `Redirect URI`, then type `http://localhost:53682/` and click Register. Copy and keep the `Application (client) ID` under the app name for later use.
1. Under `manage` select `Certificates & secrets`, click `New client secret`. Copy and keep that secret value for later use (secret value, not secret ID).
1. Under `manage` select `API permissions`, click `Add a permission` and select `Microsoft Graph` then select `delegated permissions`.
1. Search and select the following permissions: `Files.ReadWrite.All`. Once selected click `Add permissions` at the bottom.
1. Download [this script](./auth.ps1) on your Windows computer, click `run in powershell` in the right-click menu, enter your `client id` and `client secret`, and follow the instruction to get `refresh_token`. (if the script is forbidden, execute in powershell as administrator `Start-Process -Wait -Verb RunAs powershell.exe -Args "-executionpolicy bypass -command Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Force`)
1. When finished, `token.txt` is saved on your desktop. 
