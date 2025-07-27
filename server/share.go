package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type folderChildren struct {
	Message string `json:"message"`
	Value   []struct {
		Name        string `json:"name"`
		Size        int64  `json:"size"`
		DownloadUrl string `json:"@microsoft.graph.downloadUrl"`
	} `json:"value"`
}

func getShareController(c *gin.Context) {
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
}

type IDStruct struct {
	ID string `json:"id"`
}

func createShareController(c *gin.Context) {
	now := time.Now()
	dateFolder := fmt.Sprintf("%d.%02d.%02d", now.Year(), int(now.Month()), now.Day())
	folderID, ok := folders[dateFolder]
	if !ok {
		// get folder id
		res, err := client.Get(fmt.Sprintf("%s%s/root:%s%s", apiBase, drive, savePath, dateFolder))
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
			resCreate, err := client.Post(fmt.Sprintf("%s%s/root:%s:/children", apiBase, drive, strings.TrimSuffix(savePath, "/")), "application/json", strings.NewReader(payload))
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
}

type sessionCreate struct {
	WriteID string `json:"write_id"`
	Name    string `json:"name"`
}
type uploadURLStruct struct {
	UploadUrl string `json:"uploadUrl"`
}

func createAttachmentController(c *gin.Context) {
	var sc sessionCreate
	if err := c.ShouldBindJSON(&sc); err != nil {
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
}
