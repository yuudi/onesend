package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"math/rand"
)

var folders map[string]string

func init() {
	// cache folder id
	folders = make(map[string]string)
}

func shortMac(i []byte) string {
	mac := hmac.New(sha1.New, []byte(appSecret))
	mac.Write(i)
	sum := mac.Sum(nil)
	sumStr := base64.RawURLEncoding.EncodeToString(sum)
	return sumStr[0:8]
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
