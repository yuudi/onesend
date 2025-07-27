package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func clientReady(c *gin.Context) {
	if client == nil {
		var status int
		if c.Request.Method == http.MethodGet {
			status = http.StatusFound
		} else {
			status = http.StatusSeeOther
		}
		c.Redirect(status, "/web/auth.html")
		c.Abort()
		return
	}
	c.Next()
}

func publicCache(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=604800")
	c.Next()
}
