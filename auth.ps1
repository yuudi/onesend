$ErrorActionPreference = "Stop"

Write-Output "choose the account area
1> global
2> us government
3> Germany
4> China (operated by 21Vianet)

"
$account_area = Read-Host 'account type'
switch ($account_area) {
    1 { $auth_host = "login.microsoftonline.com" }
    2 { $auth_host = "login.microsoftonline.us" }
    3 { $auth_host = "login.microsoftonline.de" }
    4 { $auth_host = "login.chinacloudapi.cn" }
    Default { exit }
}

$client_id = Read-Host 'client_id'
$client_secret = Read-Host 'client_secret'

$auth_url = "https://${auth_host}/common/oauth2/v2.0/authorize?client_id=${client_id}&response_type=code&redirect_uri=http://localhost:53682/&response_mode=query&scope=offline_access%20Files.ReadWrite.All"
$auth_code = ""

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add("http://localhost:53682/")
$http.Start()

Start-Process $auth_url

while ($http.IsListening) {
    Start-Sleep -Seconds 0.1
    $context = $http.GetContext()
    $code = $context.Request.QueryString.Get("code")
    if ($code) {
        $auth_code = $code
        [string]$html = "<p>success, now you can close this window</p>"
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
        $context.Response.ContentLength64 = $buffer.Length
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
        $context.Response.OutputStream.Close()
        break
    }
    else {
        [string]$html = "<p>error, please continue <a href='${auth_url}'>here</a></p>"
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
        $context.Response.ContentLength64 = $buffer.Length
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
        $context.Response.OutputStream.Close()
    }
}

Write-Output "code received, start fetching token"

$reqdata = "client_id=${client_id}&client_secret=${client_secret}&grant_type=authorization_code&code=${auth_code}&redirect_uri=http://localhost:53682/&scope=offline_access%20Files.Read.All%20Files.ReadWrite.All%20Sites.Read.All%20Sites.ReadWrite.All%20User.Read.All%20User.ReadWrite.All%20Directory.Read.All%20Directory.ReadWrite.All%20Mail.Read%20Mail.ReadWrite%20MailboxSettings.Read%20MailboxSettings.ReadWrite"

$res = Invoke-RestMethod "https://login.microsoftonline.com/common/oauth2/v2.0/token" -Method "POST" -Body $reqdata
$refresh_token = $res.refresh_token

$desktop = [Environment]::GetFolderPath("Desktop")
New-Item -Path $desktop\token.txt -ItemType File -Value $refresh_token

Write-Output @"
==========
${refresh_token}
==========
this is your refresh_token, keep it safe
it has been saved on your desktop
"@

cmd /C PAUSE
