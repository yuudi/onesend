# api

## create share

POST /api/v1/share

**request body**: none

**response body**:

write_id: a secret id to upload file  
read_id: a public id to share file

## create file

POST /api/v1/attachment

**request body**:

write_id: a secret id to upload file  
name: filename

**response body**:

upload_url: a url to upload file

## upload file

> see [onedrive docs](https://docs.microsoft.com/onedrive/developer/rest-api/api/driveitem_createuploadsession#upload-bytes-to-the-upload-session)

upload file by chunks, file chunk must be multiples of 320KiB (327680 bytes) and no larger than 60MiB

PUT _upload_url_

**request header**:

Content-Length: total size of file  
Content-Range: uploaded part range of file

**request body**: part of file content

**response status**:

202: continue uploading  
200: file uploaded

## get share

GET /api/v1/share/<read_id>

**response body**:

value:  
├ name: filename  
├ size: file size (in bytes)  
└ @microsoft.graph.downloadUrl: url for download
