package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
	"golang.org/x/oauth2"
)

func setupOAuthClient(refreshToken, clientID, clientSecret, authURL, tokenURL string) (*http.Client, error) {
	// create cron job for refresh token, to prevent token expiration after 90 days not using
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

	client = oauth2.NewClient(ctx, tokenSource)

	// test create file
	req, err := http.NewRequest("PUT", fmt.Sprintf("%s%s/root:%sonesend.txt:/content", apiBase, drive, savePath), strings.NewReader("this folder is managed by onesend"))
	if err != nil {
		return nil, errors.New("error test create file " + err.Error())
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, errors.New("error test create file " + err.Error())
	}
	b := new(bytes.Buffer)
	_, err = b.ReadFrom(res.Body)
	if err != nil {
		return nil, errors.New("error test create file " + err.Error())
	}
	if res.StatusCode >= 400 {
		// fail
		return nil, errors.New("error test create file " + b.String())
	}
	return client, nil
}

func oauthController(c *gin.Context) {
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
}
