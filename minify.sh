npm install

mv assets assets.src
mkdir assets

npx html-minifier --collapse-whitespace --minify-css true --minify-js true homepage.html >homepage.min.html
mv homepage.min.html homepage.html
npx html-minifier --collapse-whitespace --minify-css true --minify-js true receive.html >receive.min.html
mv receive.min.html receive.html
npx html-minifier --collapse-whitespace --minify-css true --minify-js true auth.html >auth.min.html
mv auth.min.html auth.html

npx uglifycss assets.src/homepage.css >assets/homepage.css
npx uglifycss assets.src/receive.css >assets/receive.css

npx tsc ./assets.src/homepage.ts --target es2017
npx webpack ./assets.src/homepage.js -o ./dist --mode production
mv dist/main.js assets/homepage.js
npx tsc ./assets.src/receive.ts --target es2017
npx webpack ./assets.src/receive.js -o ./dist --mode production
mv dist/main.js assets/receive.js
npx tsc ./virtual-downloader.ts --target es2017
npx webpack ./virtual-downloader.js -o ./dist --mode production
mv dist/main.js virtual-downloader.js
