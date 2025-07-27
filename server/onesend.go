package main

import (
	"embed"
	"errors"
	"fmt"
	"net/http"
	"os"
	"runtime"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

//go:embed web
var webFs embed.FS

var defaultClientID = "5114220a-e543-4bc0-b1aa-c84fced70454"
var defaultClientSecret = "VMV8Q~dHlk2uuYcTddJmXtFYrPIhvKDgetassb-G"

type refreshTokenStruct struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func main() {
	err := entry()
	if err != nil {
		println(err.Error())
		// If opened by double-click, pause the console before exit
		if runtime.GOOS == "windows" {
			fmt.Println("press enter to continue...")
			_, _ = fmt.Scanln()
		}
		os.Exit(1)
	}
}

var client *http.Client = nil // waiting for token
var clientID, clientSecret, appSecret, drive, savePath, authURL, tokenURL, apiBase string

func entry() error {
	// read config file
	godotenv.Load()
	clientID = getEnv("ONESEND_CLIENT_ID", defaultClientID)
	clientSecret = getEnv("ONESEND_CLIENT_SECRET", defaultClientSecret)
	appSecret = mustGetEnv("ONESEND_APP_SECRET")
	accountArea := getEnv("ONESEND_ACCOUNT_AREA", "global")
	savePath = getEnv("ONESEND_SAVE_PATH", "/onesend")
	drive = getEnv("ONESEND_DRIVE", "/me/drive")
	listen := getEnv("ONESEND_LISTEN", "0.0.0.0:8080")

	switch accountArea {
	case "global":
		authURL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
		tokenURL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		apiBase = "https://graph.microsoft.com/v1.0"
	case "cn":
		authURL = "https://login.chinacloudapi.cn/common/oauth2/v2.0/authorize"
		tokenURL = "https://login.chinacloudapi.cn/common/oauth2/v2.0/token"
		apiBase = "https://microsoftgraph.chinacloudapi.cn/v1.0"
	case "gov":
		authURL = "https://login.microsoftonline.us/common/oauth2/v2.0/authorize"
		tokenURL = "https://login.microsoftonline.us/common/oauth2/v2.0/token"
		apiBase = "https://graph.microsoft.us/v1.0"
	case "de":
		authURL = "https://login.microsoftonline.de/common/oauth2/v2.0/authorize"
		tokenURL = "https://login.microsoftonline.de/common/oauth2/v2.0/token"
		apiBase = "https://graph.microsoft.de/v1.0"
	default:
		return errors.New("unknown account area " + accountArea)
	}
	// padding slash to path
	if savePath[0] != '/' {
		savePath = "/" + savePath
	}
	if savePath[len(savePath)-1] != '/' {
		savePath = savePath + "/"
	}

	// read token
	savedRefreshToken, err := os.ReadFile("token.txt")
	if err == nil && len(savedRefreshToken) != 0 {
		// saved token available
		client, err = setupOAuthClient(string(savedRefreshToken), clientID, clientSecret, authURL, tokenURL)
		if err != nil {
			return errors.New("error setting up oauth client " + err.Error())
		}
	} else {
		fmt.Println("token is not ready, please visit the site and follow the instructions")
	}

	// setup web server
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(gin.Recovery())
	r.GET("/", clientReady, publicCache, func(c *gin.Context) {
		c.Redirect(301, "/web/index.html")
	})
	r.GET("/index.html", clientReady, publicCache, func(c *gin.Context) {
		c.Redirect(301, "/web/index.html")
	})
	r.GET("/web", clientReady, publicCache, func(c *gin.Context) {
		c.Redirect(301, "/web/index.html")
	})
	r.GET("/web/*filename", publicCache, func(c *gin.Context) {
		filename := c.Param("filename")
		c.FileFromFS("/web/"+filename, http.FS(webFs))
	})
	r.GET("/robots.txt", publicCache, func(c *gin.Context) {
		c.Data(200, "text/plain", []byte("User-agent: *\nDisallow: /"))
	})
	r.GET("/oauth", oauthController)
	r.POST("/api/v1/share", clientReady, createShareController)
	r.POST("/api/v1/attachment", clientReady, createAttachmentController)
	r.GET("/api/v1/share/:read_id", clientReady, getShareController)
	return r.Run(listen)
}
