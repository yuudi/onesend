package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	cryptoRand "crypto/rand"
	"crypto/sha1"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
	"golang.org/x/oauth2"
)

//go:embed homepage.html
var publicIndex []byte

//go:embed auth.html
var publicAuth []byte

//go:embed receive.html
var publicReceive []byte

//go:embed virtual-downloader.js
var publicVirtualDownloader []byte

//go:embed assets
var publicAssets embed.FS

var defaultClientID = "5114220a-e543-4bc0-b1aa-c84fced70454"
var defaultClientSecret = "VMV8Q~dHlk2uuYcTddJmXtFYrPIhvKDgetassb-G"

type sessionCreate struct {
	WriteID string `json:"write_id"`
	Name    string `json:"name"`
}

type ConfigFile struct {
	Onedrive struct {
		ClientID     string
		ClientSecret string
		AccountArea  string
		Drive        string
		SavePath     string
	}
	Sender struct {
		Listen string
	}
}

type IDStruct struct {
	ID string `json:"id"`
}

type uploadURLStruct struct {
	UploadUrl string `json:"uploadUrl"`
}

type folderChildren struct {
	Message string `json:"message"`
	Value   []struct {
		Name        string `json:"name"`
		Size        int64  `json:"size"`
		DownloadUrl string `json:"@microsoft.graph.downloadUrl"`
	} `json:"value"`
}

type refreshTokenStruct struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// generate random string
func random6() string {
	letters := []byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
	r := make([]byte, 6)
	for i := range r {
		r[i] = letters[rand.Intn(len(letters))]
	}
	return string(r)
}

func main() {
	err := entry()
	if err != nil {
		println(err.Error())
		if runtime.GOOS == "windows" {
			fmt.Println("press enter to continue...")
			_, _ = fmt.Scanln()
		}
		os.Exit(1)
	}
}

func entry() error {
	// read config file
	var configFile ConfigFile
	_, err := toml.DecodeFile("config.toml", &configFile)
	if err != nil {
		return errors.New("error parsing configuration file " + err.Error())
	}

	var authURL, tokenURL, apiBase string
	switch configFile.Onedrive.AccountArea {
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
		return errors.New("unknown account area " + configFile.Onedrive.AccountArea)
	}
	// padding slash to path
	if configFile.Onedrive.SavePath[0] != '/' {
		configFile.Onedrive.SavePath = "/" + configFile.Onedrive.SavePath
	}
	if configFile.Onedrive.SavePath[len(configFile.Onedrive.SavePath)-1] != '/' {
		configFile.Onedrive.SavePath = configFile.Onedrive.SavePath + "/"
	}

	// get drive
	drive := configFile.Onedrive.Drive
	if drive == "" {
		drive = "/me/drive"
	}

	// get secret
	secret, err := getSecret()
	if err != nil {
		return err
	}
	shortMac := getShortMacFunc(secret)

	clientID := defaultClientID
	if len(configFile.Onedrive.ClientID) != 0 {
		clientID = configFile.Onedrive.ClientID
	}
	clientSecret := defaultClientSecret
	if len(configFile.Onedrive.ClientSecret) != 0 {
		clientSecret = configFile.Onedrive.ClientSecret
	}

	var client *http.Client = nil // waiting for token

	// read token
	savedRefreshToken, err := os.ReadFile("token.txt")
	if err != nil && len(savedRefreshToken) != 0 {
		// saved token available
		client, err = setupOAuthClient(string(savedRefreshToken), clientID, clientSecret, authURL, tokenURL)
		if err != nil {
			return errors.New("error setting up oauth client " + err.Error())
		}
		// test create file
		req, err := http.NewRequest("PUT", fmt.Sprintf("%s%s/root:%smeta.txt:/content", apiBase, drive, configFile.Onedrive.SavePath), strings.NewReader("this folder is managed by onesender"))
		if err != nil {
			return errors.New("error test create file " + err.Error())
		}
		res, err := client.Do(req)
		if err != nil {
			return errors.New("error test create file " + err.Error())
		}
		b := new(bytes.Buffer)
		_, err = b.ReadFrom(res.Body)
		if err != nil {
			return errors.New("error test create file " + err.Error())
		}
		if res.StatusCode >= 400 {
			// fail
			return errors.New("error test create file " + b.String())
		}
	} else {
		fmt.Println("token is not ready, please visit the site and follow the instructions")
	}

	// cache folder id
	folders := make(map[string]string)

	// setup web server
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		if client == nil {
			c.Redirect(302, "/auth.html")
			return
		}
		c.Header("Cache-Control", "public, max-age=604800")
		c.Data(200, "text/html", publicIndex)
	})
	r.GET("/index.html", func(c *gin.Context) {
		if client == nil {
			c.Redirect(302, "/auth.html")
			return
		}
		c.Header("Cache-Control", "public, max-age=604800")
		c.Data(200, "text/html", publicIndex)
	})
	r.GET("/auth.html", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=604800")
		c.Data(200, "text/html", publicAuth)
	})
	r.GET("/s/:read_id", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=604800")
		c.Data(200, "text/html", publicReceive)
	})
	r.GET("/sw.js", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=604800")
		c.Data(200, "application/javascript", publicVirtualDownloader)
	})
	r.GET("/assets/*filename", func(c *gin.Context) {
		filename := c.Param("filename")
		c.Header("Cache-Control", "public, max-age=2592000")
		c.FileFromFS("/assets/"+filename, http.FS(publicAssets))
	})
	r.GET("/robots.txt", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=2592000")
		c.Data(200, "text/plain", []byte("User-agent: *\nDisallow: /"))
	})
	r.GET("/oauth", func(c *gin.Context) {
		if client != nil {
			// pretend this is not a endpoint
			c.Data(404, "text/plain", []byte("404 Not Found"))
			return
		}
		code := c.Query("code")
		if len(code) == 0 {
			c.Data(404, "text/plain", []byte("404 Not Found"))
			return
		}
		// get token
		body := url.Values{}
		body.Set("client_id", clientID)
		body.Set("client_secret", clientSecret)
		body.Set("grant_type", "authorization_code")
		body.Set("code", code)
		body.Set("redirect_uri", "https://yuudi.github.io/onesend/oauth/index.html")
		body.Set("scope", "offline_access files.readwrite.all")
		res, err := http.Post(tokenURL, "application/x-www-form-urlencoded", strings.NewReader(body.Encode()))
		if err != nil {
			c.Data(400, "text/plain", []byte("error fetching token "+err.Error()))
			return
		}
		var tokens refreshTokenStruct
		b := new(bytes.Buffer)
		_, err = b.ReadFrom(res.Body)
		if err != nil {
			c.Data(500, "text/plain", []byte("error fetching token "+err.Error()))
			return
		}
		err = json.Unmarshal(b.Bytes(), &tokens)
		if err != nil {
			c.Data(500, "text/plain", []byte("error fetching token "+err.Error()))
			return
		}
		if err != nil {
			c.Data(500, "text/plain", []byte("error fetching token "+err.Error()))
			return
		}
		err = os.WriteFile("token.txt", []byte(tokens.RefreshToken), 0600)
		if err != nil {
			c.Data(500, "text/plain", []byte("error saving token "+err.Error()))
			return
		}
		client, err = setupOAuthClient(tokens.RefreshToken, clientID, clientSecret, authURL, tokenURL)
		if err != nil {
			c.Data(500, "text/plain", []byte("error setting up oauth client "+err.Error()))
			return
		}
		err = os.WriteFile("token.txt", []byte(tokens.RefreshToken), 0600)
		if err != nil {
			c.Data(500, "text/plain", []byte("error saving token "+err.Error()))
			return
		}
		c.Data(201, "text/plain", []byte("success"))
	})
	r.POST("/api/v1/share", func(c *gin.Context) {
		if client == nil {
			c.Data(500, "text/plain", []byte("not ready"))
			return
		}
		now := time.Now()
		dateFolder := fmt.Sprintf("%d.%02d.%02d", now.Year(), int(now.Month()), now.Day())
		folderID, ok := folders[dateFolder]
		if !ok {
			// get folder id
			res, err := client.Get(fmt.Sprintf("%s%s/root:%s%s", apiBase, drive, configFile.Onedrive.SavePath, dateFolder))
			if err != nil {
				c.Data(500, "text/plain", []byte("error fetching folder "+err.Error()))
				return
			}
			b := new(bytes.Buffer)
			_, err = b.ReadFrom(res.Body)
			if err != nil {
				c.Data(500, "text/plain", []byte("error reading response fetching folder "+err.Error()))
				return
			}
			if res.StatusCode == 404 {
				payload := fmt.Sprintf("{\"name\":\"%s\",\"folder\":{},\"@microsoft.graph.conflictBehavior\":\"rename\"}", dateFolder)
				resCreate, err := client.Post(fmt.Sprintf("%s%s/root:%s:/children", apiBase, drive, strings.TrimSuffix(configFile.Onedrive.SavePath, "/")), "application/json", strings.NewReader(payload))
				if err != nil {
					c.Data(500, "text/plain", []byte("error creating folder "+err.Error()))
					return
				}
				b := new(bytes.Buffer)
				_, err = b.ReadFrom(resCreate.Body)
				if err != nil {
					c.Data(500, "text/plain", []byte("error reading response creating folder "+err.Error()))
					return
				}
				var idStruct IDStruct
				err = json.Unmarshal(b.Bytes(), &idStruct)
				if err != nil || idStruct.ID == "" {
					c.Data(500, "text/plain", []byte("error creating folder "+b.String()))
					return
				}
				folderID = idStruct.ID
				folders[dateFolder] = folderID
			} else if res.StatusCode == 200 {
				var idStruct IDStruct
				err = json.Unmarshal(b.Bytes(), &idStruct)
				if err != nil || idStruct.ID == "" {
					c.Data(500, "text/plain", []byte("error fetching folder "+b.String()))
					return
				}
				folderID = idStruct.ID
				folders[dateFolder] = folderID
			} else {
				c.Data(500, "text/plain", []byte("error fetching folder "+b.String()))
				return
			}
		}
		payload := fmt.Sprintf("{\"name\":\"%s\",\"folder\":{},\"@microsoft.graph.conflictBehavior\":\"rename\"}", random6())
		res, err := client.Post(
			fmt.Sprintf("%s%s/items/%s/children", apiBase, drive, folderID),
			"application/json",
			strings.NewReader(payload),
		)
		if err != nil {
			c.Data(500, "text/plain", []byte("error create file "+err.Error()))
			return
		}
		b := new(bytes.Buffer)
		if _, err = b.ReadFrom(res.Body); err != nil {
			c.Data(500, "text/plain", []byte("error read response "+err.Error()))
			return
		}
		if res.StatusCode != 201 {
			c.Data(500, "text/plain", []byte("error create file "+b.String()))
			return
		}
		var idStruct IDStruct
		err = json.Unmarshal(b.Bytes(), &idStruct)
		if err != nil {
			c.Data(500, "text/plain", []byte("error parsing json response "+err.Error()))
			return
		}
		//id:=idStruct.ID
		rID := "R." + idStruct.ID
		wID := "W." + idStruct.ID
		rSum := shortMac([]byte(rID))
		wSum := shortMac([]byte(wID))
		c.JSON(201, gin.H{
			"read_id":  rID + "." + rSum,
			"write_id": wID + "." + wSum,
		})
	})
	r.POST("/api/v1/attachment", func(c *gin.Context) {
		if client == nil {
			c.Data(500, "text/plain", []byte("not ready"))
			return
		}
		var sc sessionCreate
		if err := c.BindJSON(&sc); err != nil {
			c.Data(400, "text/plain", []byte("request json error  "+err.Error()))
			return
		}
		// check signing
		writeID := strings.Split(sc.WriteID, ".")
		if len(writeID) != 3 {
			c.JSON(400, gin.H{
				"error": "invalid write_id",
			})
			return
		}
		if writeID[0] != "W" {
			c.JSON(400, gin.H{
				"error": "invalid write_id",
			})
			return
		}
		signed := shortMac([]byte("W." + writeID[1]))
		if writeID[2] != signed {
			c.JSON(400, gin.H{
				"error": "invalid write_id",
			})
			return
		}
		if !strings.HasSuffix(sc.Name, ".send") {
			c.JSON(400, gin.H{
				"error": "invalid filename",
			})
			return
		}
		req, err := http.NewRequest("POST", fmt.Sprintf("%s%s/items/%s:/%s:/createUploadSession", apiBase, drive, writeID[1], sc.Name), strings.NewReader(""))
		if err != nil {
			c.Data(500, "text/plain", []byte("error create file "+err.Error()))
			return
		}
		res, err := client.Do(req)
		if err != nil {
			c.Data(500, "text/plain", []byte("error create file "+err.Error()))
			return
		}
		b := new(bytes.Buffer)
		if _, err = b.ReadFrom(res.Body); err != nil {
			c.Data(500, "text/plain", []byte("error read response "+err.Error()))
			return
		}
		if res.StatusCode >= 400 {
			c.Data(500, "text/plain", []byte("error read response "+b.String()))
			return
		}
		var uploadUrl uploadURLStruct
		err = json.Unmarshal(b.Bytes(), &uploadUrl)
		if err != nil {
			c.Data(500, "text/plain", []byte("error parsing json response "+err.Error()))
			return
		}
		c.JSON(201, gin.H{
			"upload_url": uploadUrl.UploadUrl,
		})
	})
	r.GET("/api/v1/share/:read_id", func(c *gin.Context) {
		if client == nil {
			c.Data(500, "text/plain", []byte("not ready"))
			return
		}
		readID := strings.Split(c.Param("read_id"), ".")
		if len(readID) != 3 {
			c.JSON(400, gin.H{
				"error": "invalid read_id",
			})
			return
		}
		if !(readID[0] == "R" || readID[0] == "W") {
			c.JSON(400, gin.H{
				"error": "invalid read_id",
			})
			return
		}
		signed := shortMac([]byte(readID[0] + "." + readID[1]))
		if readID[2] != signed {
			c.JSON(400, gin.H{
				"error": "invalid read_id",
			})
			return
		}
		res, err := client.Get(fmt.Sprintf("%s%s/items/%s/children", apiBase, drive, readID[1]))
		if err != nil {
			c.Data(500, "text/plain", []byte("error fetching folder "+err.Error()))
			return
		}
		b := new(bytes.Buffer)
		_, err = b.ReadFrom(res.Body)
		if err != nil {
			c.Data(500, "text/plain", []byte("error reading response fetching folder "+err.Error()))
			return
		}
		var children folderChildren
		err = json.Unmarshal(b.Bytes(), &children)
		if err != nil {
			c.Data(500, "text/plain", []byte("error parsing json fetching folder "+err.Error()))
			return
		}
		if res.StatusCode >= 400 {
			c.JSON(res.StatusCode, children.Message)
			return
		}
		c.Header("Cache-Control", "private, max-age=1800")
		c.JSON(200, children)
	})
	return r.Run(configFile.Sender.Listen)
}

func setupOAuthClient(refreshToken, clientID, clientSecret, authURL, tokenURL string) (*http.Client, error) {
	// create cron job for refresh token
	crontab := cron.New()
	ctx := context.Background()

	conf := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Scopes:       []string{"Files.ReadWrite.All", "offline_access"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  authURL,
			TokenURL: tokenURL,
		},
	}

	token := new(oauth2.Token)
	token.AccessToken = ""
	token.TokenType = "Bearer"
	token.RefreshToken = refreshToken
	tokenSource := conf.TokenSource(ctx, token)

	_, err := crontab.AddFunc("@daily", func() {
		t, e := tokenSource.Token()
		if e != nil {
			return
		}
		_ = os.WriteFile("token.txt", []byte(t.RefreshToken), 0644)
	})
	if err != nil {
		return nil, err
	}
	crontab.Start()

	return oauth2.NewClient(ctx, tokenSource), nil
}

func getSecret() ([]byte, error) {
	s, err := os.ReadFile("secret.dat")
	if err != nil {
		if os.IsNotExist(err) {
			return createSecret()
		}
		return nil, err
	}
	return s, nil
}

func createSecret() ([]byte, error) {
	s := make([]byte, 16)
	_, err := cryptoRand.Read(s)
	if err != nil {
		return nil, err
	}
	err = os.WriteFile("secret.dat", s, 0600)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func getShortMacFunc(secret []byte) func([]byte) string {
	return func(i []byte) string {
		mac := hmac.New(sha1.New, secret)
		mac.Write(i)
		sum := mac.Sum(nil)
		sumStr := base64.RawURLEncoding.EncodeToString(sum)
		return sumStr[0:8]
	}
}
