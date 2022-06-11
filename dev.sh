tsc assets/homepage-src.ts --target es2015 --out assets/homepage.js
tsc assets/receive-src.ts --target es2015 --out assets/receive.js
tsc virtual-downloader-src.ts --target es2015 --out virtual-downloader.js
go build -o "dist/onesend.dev" .
rm **/*.js
(cd dist; ./onesend.dev)
